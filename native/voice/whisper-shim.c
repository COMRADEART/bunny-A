/*
 * bunny-whisper-shim.c - a small, ABI-stable C surface over whisper.cpp v1.9.4 (tag b5130, commit 927cfce).
 *
 * The C# voice worker calls only these four functions, so it never marshals whisper structs. The shim links the
 * staged whisper.dll / ggml.dll / ggml-base.dll from the same runtime directory it is placed in.
 *
 * Build (scripts/build-voice-worker.mjs):
 *   gcc -O2 -Wall -Wextra -Werror -std=c11 -shared -static-libgcc -I<whisper include> -I<ggml include>
 *       -o bunny-whisper-shim.dll whisper-shim.c whisper.dll ggml.dll ggml-base.dll
 *
 * Silence: whisper and ggml logs are routed to a no-op callback, so nothing (transcripts included) reaches stderr.
 * Local only: no network, no GPU, no file writes. The model is read once by bws_init.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdlib.h>
#include <string.h>

#include "whisper.h"
#include "ggml-backend.h"

#define BWS_VERSION_STRING "whisper.cpp v1.9.4 (927cfce)"
#define BWS_EXPORT __declspec(dllexport)
#define BWS_MAX_SAMPLES (16000 * 60 * 5) /* 5 minutes: a hard bound on one decode */

typedef struct bws_ctx {
    struct whisper_context *wctx;
    int threads;
} bws_ctx;

static void bws_silent_log(enum ggml_log_level level, const char *text, void *user) {
    (void)level;
    (void)text;
    (void)user;
}

/* Directory that contains this shim (the runtime directory). CPU backends (ggml-cpu-*.dll) load from here. */
static void bws_module_dir(char *out, DWORD cap) {
    HMODULE self = NULL;
    out[0] = '\0';
    if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            (LPCSTR)(const void *)&bws_module_dir, &self)) {
        return;
    }
    DWORD n = GetModuleFileNameA(self, out, cap);
    if (n == 0 || n >= cap) {
        out[0] = '\0';
        return;
    }
    for (DWORD i = n; i > 0; i--) {
        if (out[i - 1] == '\\' || out[i - 1] == '/') {
            out[i - 1] = '\0';
            return;
        }
    }
    out[0] = '\0';
}

BWS_EXPORT const char *bws_version(void) {
    return BWS_VERSION_STRING;
}

/* Returns an opaque context, or NULL on any failure (missing model, bad file, no CPU backend). */
BWS_EXPORT void *bws_init(const char *model_utf8_path, int threads) {
    char dir[MAX_PATH];
    if (model_utf8_path == NULL || model_utf8_path[0] == '\0') return NULL;

    whisper_log_set(bws_silent_log, NULL);
    ggml_log_set(bws_silent_log, NULL);

    bws_module_dir(dir, (DWORD)sizeof dir);
    if (dir[0] != '\0') ggml_backend_load_all_from_path(dir);

    struct whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;
    cparams.flash_attn = false;

    struct whisper_context *w = whisper_init_from_file_with_params(model_utf8_path, cparams);
    if (w == NULL) return NULL;

    bws_ctx *c = (bws_ctx *)malloc(sizeof *c);
    if (c == NULL) {
        whisper_free(w);
        return NULL;
    }
    c->wctx = w;
    c->threads = threads < 1 ? 1 : (threads > 64 ? 64 : threads);
    return c;
}

/*
 * Decodes one utterance of 16 kHz mono float32 PCM. Output is the joined segment text (UTF-8, NUL-terminated,
 * at most out_cap - 1 bytes). confidence is the mean probability of the non-special tokens (0..1). no_speech_prob is
 * the largest per-segment no-speech probability (1.0 when whisper produced no segment).
 * Returns the number of bytes written (>= 0), or a negative code: -1 bad arguments, -2 whisper_full failed,
 * -3 output truncated to out_cap - 1 bytes (the written prefix is still valid text).
 */
BWS_EXPORT int bws_transcribe(void *ctx, const float *pcm, int n_samples, char *out_utf8, int out_cap,
                              float *confidence, float *no_speech_prob) {
    bws_ctx *c = (bws_ctx *)ctx;
    int len = 0;
    int rc = 0;
    int n_seg;
    double psum = 0.0;
    long pcount = 0;
    float max_nsp = 0.0f;
    whisper_token eot;
    struct whisper_full_params wp;

    if (c == NULL || c->wctx == NULL || out_utf8 == NULL || out_cap < 1 || confidence == NULL || no_speech_prob == NULL) {
        return -1;
    }
    *confidence = 0.0f;
    *no_speech_prob = 1.0f;
    out_utf8[0] = '\0';
    if (n_samples <= 0) return 0;
    if (pcm == NULL || n_samples > BWS_MAX_SAMPLES) return -1;

    wp = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wp.language = "en";
    wp.detect_language = false;
    wp.translate = false;
    wp.no_timestamps = true;
    wp.no_context = true;
    wp.single_segment = false;
    wp.print_progress = false;
    wp.print_realtime = false;
    wp.print_timestamps = false;
    wp.print_special = false;
    wp.suppress_blank = true;
    wp.temperature = 0.0f;
    wp.temperature_inc = 0.0f; /* no temperature fallback: greedy and deterministic */
    wp.n_threads = c->threads;

    if (whisper_full(c->wctx, wp, pcm, n_samples) != 0) return -2;

    eot = whisper_token_eot(c->wctx);
    n_seg = whisper_full_n_segments(c->wctx);
    for (int s = 0; s < n_seg; s++) {
        const char *txt;
        size_t tl;
        int nt;
        float nsp = whisper_full_get_segment_no_speech_prob(c->wctx, s);
        if (nsp > max_nsp) max_nsp = nsp;

        txt = whisper_full_get_segment_text(c->wctx, s);
        if (txt != NULL) {
            while (*txt == ' ') txt++;
            tl = strlen(txt);
            if (tl > 0) {
                if (len > 0 && len < out_cap - 1) out_utf8[len++] = ' ';
                size_t room = (size_t)(out_cap - 1 - len);
                if (tl > room) {
                    tl = room;
                    rc = -3;
                }
                memcpy(out_utf8 + len, txt, tl);
                len += (int)tl;
                out_utf8[len] = '\0';
            }
        }

        nt = whisper_full_n_tokens(c->wctx, s);
        for (int t = 0; t < nt; t++) {
            whisper_token id = whisper_full_get_token_id(c->wctx, s, t);
            if (id >= eot) continue; /* special tokens (EOT, timestamps, language, task) are not evidence */
            psum += whisper_full_get_token_p(c->wctx, s, t);
            pcount++;
        }
    }

    if (n_seg > 0) *no_speech_prob = max_nsp;
    if (pcount > 0) {
        double mean = psum / (double)pcount;
        if (mean < 0.0) mean = 0.0;
        if (mean > 1.0) mean = 1.0;
        *confidence = (float)mean;
    }
    if (rc != 0) return rc;
    return len;
}

BWS_EXPORT void bws_free(void *ctx) {
    bws_ctx *c = (bws_ctx *)ctx;
    if (c == NULL) return;
    if (c->wctx != NULL) whisper_free(c->wctx);
    free(c);
}

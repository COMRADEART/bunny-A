/* T9R-F04 disposable process-containment fixture (test-only, never packaged).
 * Prints one JSON line per action to stdout. Performs no network or file I/O
 * beyond its own stdio. Modes:
 *   sleep <ms>                   live for <ms>, then exit 0
 *   tree <ms>                    child(+grandchild), short-lived child, long-lived child,
 *                                detached child, parent-exits-before-child chain
 *   breakaway <ms>               CreateProcess(CREATE_BREAKAWAY_FROM_JOB) of `sleep <ms>`
 *   silent <ms>                  member creates its OWN nested job allowing (silent) breakaway,
 *                                joins it, then launches children with and without the flag
 *   orphan <ms>                  spawn `chain <ms>` and exit immediately (parent before child)
 *   chain <ms>                   spawn `sleep <ms>` then live for <ms>
 *   burst <n>                    launch <n> instantly-exiting children as fast as possible
 *   stdin                        read stdin to EOF, echo its byte count and SHA-like sum
 */
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static wchar_t self[MAX_PATH];
static void line(const char *kind, DWORD pid, DWORD error) {
  printf("{\"fixture\":%lu,\"event\":\"%s\",\"pid\":%lu,\"error\":%lu}\n", (unsigned long)GetCurrentProcessId(), kind, (unsigned long)pid, (unsigned long)error);
  fflush(stdout);
}
static DWORD launch(const wchar_t *args, DWORD flags, HANDLE *out) {
  wchar_t command[1024];
  _snwprintf(command, 1024, L"\"%ls\" %ls", self, args);
  STARTUPINFOW si = {0}; PROCESS_INFORMATION pi = {0}; si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE); si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE); si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  if (!CreateProcessW(self, command, NULL, NULL, TRUE, flags | CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) return 0;
  CloseHandle(pi.hThread);
  if (out) *out = pi.hProcess; else CloseHandle(pi.hProcess);
  return pi.dwProcessId;
}
static void child(const char *kind, const wchar_t *args, DWORD flags) {
  DWORD pid = launch(args, flags, NULL);
  line(kind, pid, pid ? 0 : GetLastError());
}
int wmain(int argc, wchar_t **argv) {
  GetModuleFileNameW(NULL, self, MAX_PATH);
  if (argc < 2) return 2;
  const wchar_t *mode = argv[1];
  DWORD ms = argc > 2 ? (DWORD)wcstoul(argv[2], NULL, 10) : 1000;
  wchar_t args[64];
  line("start", GetCurrentProcessId(), 0);
  if (!wcscmp(mode, L"sleep")) { Sleep(ms); return 0; }
  if (!wcscmp(mode, L"chain")) { _snwprintf(args, 64, L"sleep %lu", (unsigned long)ms); child("chain-child", args, 0); Sleep(ms); return 0; }
  if (!wcscmp(mode, L"orphan")) { _snwprintf(args, 64, L"chain %lu", (unsigned long)ms); child("orphan-chain", args, 0); return 0; }
  if (!wcscmp(mode, L"tree")) {
    _snwprintf(args, 64, L"chain %lu", (unsigned long)ms); child("child-with-grandchild", args, 0);
    child("short-lived-child", L"sleep 50", 0);
    _snwprintf(args, 64, L"sleep %lu", (unsigned long)ms); child("long-lived-child", args, 0);
    child("detached-child", args, DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    _snwprintf(args, 64, L"orphan %lu", (unsigned long)ms); child("orphaning-child", args, 0);
    Sleep(ms); return 0;
  }
  if (!wcscmp(mode, L"breakaway")) {
    _snwprintf(args, 64, L"sleep %lu", (unsigned long)ms);
    child("breakaway-attempt", args, CREATE_BREAKAWAY_FROM_JOB);
    Sleep(ms); return 0;
  }
  if (!wcscmp(mode, L"silent")) {
    HANDLE job = CreateJobObjectW(NULL, NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
    BOOL configured = job && SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    line("nested-job-configured", 0, configured ? 0 : GetLastError());
    BOOL joined = configured && AssignProcessToJobObject(job, GetCurrentProcess());
    line("nested-job-joined", 0, joined ? 0 : GetLastError());
    _snwprintf(args, 64, L"sleep %lu", (unsigned long)ms);
    child("silent-breakaway-child", args, 0);
    child("explicit-breakaway-from-nested", args, CREATE_BREAKAWAY_FROM_JOB);
    Sleep(ms); return 0;
  }
  if (!wcscmp(mode, L"burst")) {
    DWORD started = 0;
    for (DWORD i = 0; i < ms; i++) if (launch(L"sleep 0", 0, NULL)) started++;
    line("burst-started", started, 0); return 0;
  }
  if (!wcscmp(mode, L"stdin")) {
    char buffer[65536]; DWORD read = 0; unsigned long long total = 0, sum = 1469598103934665603ULL;
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    while (ReadFile(in, buffer, sizeof(buffer), &read, NULL) && read) { total += read; for (DWORD i = 0; i < read; i++) { sum ^= (unsigned char)buffer[i]; sum *= 1099511628211ULL; } }
    printf("{\"fixture\":%lu,\"event\":\"stdin\",\"bytes\":%llu,\"fnv1a\":\"%016llx\"}\n", (unsigned long)GetCurrentProcessId(), total, sum);
    fflush(stdout); return 0;
  }
  return 3;
}

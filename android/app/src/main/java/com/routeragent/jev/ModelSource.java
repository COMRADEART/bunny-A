package com.routeragent.jev;

/** On-device voice: the one pinned model file (Gemma 4 E2B for LiteRT-LM, Apache-2.0, not gated). */
final class ModelSource {
    static final String REPO = "litert-community/gemma-4-E2B-it-litert-lm";
    static final String REVISION = "2d74ac41a33d7da82f39f7d5720a04c68514a103";
    static final String FILE = "gemma-4-E2B-it.litertlm";
    static final long SIZE = 2_588_147_712L;
    static final String SHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c";

    private ModelSource() {}

    static String url() { return "https://huggingface.co/" + REPO + "/resolve/" + REVISION + "/" + FILE; }
}

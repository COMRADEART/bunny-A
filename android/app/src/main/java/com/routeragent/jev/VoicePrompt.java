package com.routeragent.jev;

import java.util.List;

/** On-device voice: the system instructions given to the phone model, and cleaning of what it says back. */
final class VoicePrompt {
    static final int MAX_WORK_LINES = 20;
    static final int MAX_LINE = 120;
    static final int MAX_SPOKEN = 600;

    static final String DICTATE = "Transcribe the audio exactly. Output only the words spoken, with no quotes and no commentary.";
    static final String TALK = "You are Bunny, a voice assistant running on this phone. Answer the spoken question in at most three short sentences, "
            + "in plain words with no formatting. You cannot run tasks, approve anything or change files; those happen on the Windows workstation.";

    private VoicePrompt() {}

    static String system(VoiceSession.Mode mode, List<String> workLines, boolean workstationReachable) {
        if (mode == VoiceSession.Mode.DICTATE) return DICTATE;
        StringBuilder out = new StringBuilder(TALK);
        int added = 0;
        if (workLines != null) {
            for (String item : workLines) {
                if (added == MAX_WORK_LINES) break;
                // A title is one line of data: whitespace (including newlines) collapses so it cannot add instructions of its own.
                String line = item == null ? "" : item.replaceAll("\\s+", " ").trim();
                if (line.isEmpty()) continue;
                if (added == 0) out.append("\nWork shown on this phone right now:");
                out.append("\n- ").append(line.length() > MAX_LINE ? line.substring(0, MAX_LINE) : line);
                added++;
            }
        }
        if (added == 0) out.append("\nNo missions or tasks are shown on this phone.");
        if (!workstationReachable) out.append("\nThe workstation is not reachable right now, so this list may be out of date.");
        return out.toString();
    }

    /** Plain words for speech or the message box: no markdown marks or list markers, single spaces, at most MAX_SPOKEN characters. */
    static String clean(String modelText) {
        if (modelText == null) return "";
        StringBuilder plain = new StringBuilder();
        for (String line : modelText.split("\r?\n")) {
            // shortcut: a reply that starts "3. ..." loses its "3."; acceptable for spoken answers, revisit if numbered replies matter.
            plain.append(line.replaceFirst("^\\s*(?:[-*+•]|\\d{1,2}[.)])\\s+", "")).append(' ');
        }
        String text = plain.toString().replaceAll("[*#`]", "").replaceAll("\\s+", " ").trim();
        if (text.length() <= MAX_SPOKEN) return text;
        String cut = text.substring(0, MAX_SPOKEN);
        int space = cut.lastIndexOf(' ');
        return (space > 0 ? cut.substring(0, space) : cut).trim();
    }
}

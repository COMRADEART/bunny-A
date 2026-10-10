/* T9R-F04 nested-job validation wrapper (test-only, never packaged).
 * Usage: f04-job-wrapper <mode> <command line...>
 *   none     launch the command with CREATE_BREAKAWAY_FROM_JOB (outside any job if the enclosing job allows it)
 *   plain    put the command in a new parent job with KILL_ON_JOB_CLOSE only (compatible parent)
 *   limit1   parent job with JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1 (incompatible: no room for a provider)
 *   silent   parent job with BREAKAWAY_OK | SILENT_BREAKAWAY_OK | KILL_ON_JOB_CLOSE (permissive parent)
 * Prints one JSON line about the wrapper setup, then waits for the command and returns its exit code.
 */
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
int wmain(int argc, wchar_t **argv) {
  if (argc < 3) return 2;
  const wchar_t *mode = argv[1];
  wchar_t *line = wcsstr(GetCommandLineW(), argv[2]);
  if (!line) return 2;
  if (line > GetCommandLineW() && line[-1] == L'"') line--;
  HANDLE job = NULL; DWORD flags = CREATE_SUSPENDED;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  if (!wcscmp(mode, L"none")) flags |= CREATE_BREAKAWAY_FROM_JOB;
  else if (!wcscmp(mode, L"direct")) { /* no new job, no breakaway: inherits whatever job the wrapper has */ }
  else {
    job = CreateJobObjectW(NULL, NULL);
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!wcscmp(mode, L"limit1")) { limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS; limits.BasicLimitInformation.ActiveProcessLimit = 1; }
    if (!wcscmp(mode, L"silent")) limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
    if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) { printf("{\"wrapper\":\"%ls\",\"error\":%lu}\n", mode, GetLastError()); return 3; }
  }
  STARTUPINFOW si = {0}; PROCESS_INFORMATION pi = {0}; si.cb = sizeof(si);
  if (!CreateProcessW(NULL, line, NULL, NULL, TRUE, flags, NULL, NULL, &si, &pi)) { printf("{\"wrapper\":\"%ls\",\"createError\":%lu}\n", mode, GetLastError()); fflush(stdout); return 4; }
  if (job && !AssignProcessToJobObject(job, pi.hProcess)) { printf("{\"wrapper\":\"%ls\",\"assignError\":%lu}\n", mode, GetLastError()); TerminateProcess(pi.hProcess, 1); return 5; }
  BOOL inAny = FALSE; IsProcessInJob(pi.hProcess, NULL, &inAny);
  printf("{\"wrapper\":\"%ls\",\"childPid\":%lu,\"childInAnyJob\":%s,\"limitFlags\":%lu}\n", mode, pi.dwProcessId, inAny ? "true" : "false", limits.BasicLimitInformation.LimitFlags);
  fflush(stdout);
  /* Under a broker launch (WMI) there is no stdout: the same line also goes to wrapper-<mode>.json in the cwd. */
  wchar_t log[64]; _snwprintf(log, 64, L"wrapper-%ls.json", mode);
  FILE *file = _wfopen(log, L"w");
  if (file) { fprintf(file, "{\"wrapper\":\"%ls\",\"childPid\":%lu,\"childInAnyJob\":%s,\"limitFlags\":%lu}\n", mode, pi.dwProcessId, inAny ? "true" : "false", limits.BasicLimitInformation.LimitFlags); fclose(file); }
  ResumeThread(pi.hThread);
  WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);
  return (int)code;
}

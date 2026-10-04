/* Harmless T4 probe: explicitly ask Windows to break away. A correctly
 * configured Bunny job refuses creation (ERROR_ACCESS_DENIED). */
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdio.h>
#include <string.h>
int main(int argc,char **argv) {
  if(argc>1&&strcmp(argv[1],"sleeper")==0){Sleep(3000);return 0;}
  wchar_t file[32768],line[32768];GetModuleFileNameW(NULL,file,32768);
  swprintf(line,32768,L"\"%ls\" sleeper",file);
  STARTUPINFOW si={0};PROCESS_INFORMATION pi={0};si.cb=sizeof(si);
  Sleep(100);
  BOOL created=CreateProcessW(file,line,NULL,NULL,FALSE,CREATE_BREAKAWAY_FROM_JOB|CREATE_NO_WINDOW,NULL,NULL,&si,&pi);
  DWORD error=created?0:GetLastError();
  printf("T4_BREAKAWAY created=%d error=%lu\n",created,(unsigned long)error);
  if(created){TerminateProcess(pi.hProcess,1);CloseHandle(pi.hProcess);CloseHandle(pi.hThread);return 2;}
  return error==ERROR_ACCESS_DENIED?0:3;
}

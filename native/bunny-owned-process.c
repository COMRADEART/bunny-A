/* Windows x64, Node-API v8. No Node/V8 C++ ABI or third-party runtime.
 * Stable C signatures: https://nodejs.org/api/n-api.html . Resolve only the
 * documented exports from node.exe. A PID alone never confers authority.
 */
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uchar.h>
#include <wchar.h>
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef napi_value (*napi_callback)(napi_env,napi_callback_info);
typedef void (*napi_finalize)(napi_env,void*,void*);
#define API(name,args) static int (*name) args
API(napi_get_cb_info,(napi_env,napi_callback_info,size_t*,napi_value*,napi_value*,void**));
API(napi_get_value_string_utf16,(napi_env,napi_value,char16_t*,size_t,size_t*));
API(napi_get_value_external,(napi_env,napi_value,void**));
API(napi_create_external,(napi_env,void*,napi_finalize,void*,napi_value*));
API(napi_create_function,(napi_env,const char*,size_t,napi_callback,void*,napi_value*));
API(napi_set_named_property,(napi_env,napi_value,const char*,napi_value));
API(napi_create_object,(napi_env,napi_value*));
API(napi_create_array,(napi_env,napi_value*));
API(napi_set_element,(napi_env,napi_value,uint32_t,napi_value));
API(napi_create_double,(napi_env,double,napi_value*));
API(napi_create_string_utf16,(napi_env,const char16_t*,size_t,napi_value*));
API(napi_get_null,(napi_env,napi_value*));
API(napi_throw_error,(napi_env,const char*,const char*));
API(napi_add_env_cleanup_hook,(napi_env,void(*)(void*),void*));
typedef struct Group { HANDLE job,root;DWORD pid;napi_env env;struct Group *next; } Group;
static Group *groups;
static napi_value fail(napi_env env,const char *stage,DWORD error) {
  char message[192];snprintf(message,sizeof(message),"Windows ownership failed closed at %s (Win32 %lu).",stage,(unsigned long)error);
  napi_throw_error(env,"BUNNY_JOB_FAILED",message);return NULL;
}
static void close_group(Group *g) {
  /* Host holds the sole non-inheritable job handle. Closure kills ALL members,
   * including descendants whose immediate parent has already exited. */
  if(g->job){
    TerminateJobObject(g->job,1);
    ULONGLONG deadline=GetTickCount64()+1500;
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION account;
    while(QueryInformationJobObject(g->job,JobObjectBasicAccountingInformation,&account,sizeof(account),NULL)&&account.ActiveProcesses&&GetTickCount64()<deadline) Sleep(2);
    CloseHandle(g->job);g->job=NULL;
  }
  if(g->root){CloseHandle(g->root);g->root=NULL;}
}
static void finalize(napi_env env,void *data,void *hint) {
  (void)env;(void)hint;Group *g=data,**entry=&groups;close_group(g);
  while(*entry&&*entry!=g)entry=&(*entry)->next;
  if(*entry) *entry=g->next;
  free(g);
}
static void cleanup(void *env){for(Group *g=groups;g;g=g->next)if(g->env==env)close_group(g);}
static wchar_t *string(napi_env env,napi_value value,size_t *length) {
  size_t n=0;if(napi_get_value_string_utf16(env,value,NULL,0,&n)!=0||n>1048576)return NULL;
  wchar_t *result=calloc(n+2,sizeof(wchar_t));if(!result)return NULL;
  if(napi_get_value_string_utf16(env,value,(char16_t*)result,n+1,&n)!=0){free(result);return NULL;}
  *length=n;return result;
}
static Group *argument(napi_env env,napi_callback_info info) {
  size_t count=1;napi_value value;void *pointer=NULL;
  if(napi_get_cb_info(env,info,&count,&value,NULL,NULL)!=0||count!=1||napi_get_value_external(env,value,&pointer)!=0)return NULL;
  for(Group *g=groups;g;g=g->next)if(g==pointer&&g->env==env)return g;
  return NULL;
}
static void number(napi_env env,napi_value object,const char *key,double value){napi_value v;napi_create_double(env,value,&v);napi_set_named_property(env,object,key,v);}
static double created(HANDLE process) {
  FILETIME birth,exit,kernel,user;ULARGE_INTEGER time;
  if(!GetProcessTimes(process,&birth,&exit,&kernel,&user))return 0;
  time.LowPart=birth.dwLowDateTime;time.HighPart=birth.dwHighDateTime;
  return(double)(time.QuadPart/10000ULL-11644473600000ULL);
}
static napi_value launch(napi_env env,napi_callback_info info) {
  napi_value values[6],result=NULL;size_t count=6,n[6];wchar_t *s[6]={0};
  HANDLE job=NULL,handles[3]={NULL,NULL,NULL};LPPROC_THREAD_ATTRIBUTE_LIST attributes=NULL;BOOL attributesReady=FALSE;
  PROCESS_INFORMATION pi={0};STARTUPINFOEXW si={0};DWORD error=ERROR_INVALID_PARAMETER;const char *stage="arguments";
  if(napi_get_cb_info(env,info,&count,values,NULL,NULL)!=0||count!=6)return fail(env,stage,error);
  for(int i=0;i<6;i++){s[i]=string(env,values[i],&n[i]);if(!s[i]||(i!=3&&wcslen(s[i])!=n[i]))goto failed;}
  if(!n[0]||!n[1]||n[1]>=32767||!n[2]||n[3]<2||s[3][n[3]-1]||s[3][n[3]-2])goto failed;
  stage="CreateJobObject";job=CreateJobObjectW(NULL,NULL);if(!job){error=GetLastError();goto failed;}
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  stage="job limits";if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))){error=GetLastError();goto failed;}
  SECURITY_ATTRIBUTES security={sizeof(SECURITY_ATTRIBUTES),NULL,TRUE};stage="stdio";
  handles[0]=CreateFileW(L"NUL",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,&security,OPEN_EXISTING,0,NULL);
  for(int i=1;i<3;i++)handles[i]=CreateFileW(s[i+3],GENERIC_WRITE,0,&security,OPEN_EXISTING,SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,NULL);
  for(int i=0;i<3;i++)if(handles[i]==INVALID_HANDLE_VALUE){error=GetLastError();goto failed;}
  SIZE_T bytes=0;InitializeProcThreadAttributeList(NULL,2,0,&bytes);attributes=malloc(bytes);stage="startup attributes";
  if(!attributes||!InitializeProcThreadAttributeList(attributes,2,0,&bytes)){error=GetLastError();goto failed;}attributesReady=TRUE;
  /* Windows 10+ JOB_LIST assigns ownership atomically during CreateProcess.
   * Death before ResumeThread cannot orphan the root. HANDLE_LIST inherits
   * ONLY stdio: never job/root/other Host handles. No breakaway flags. */
  if(!UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,sizeof(handles),NULL,NULL)||
     !UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job,sizeof(job),NULL,NULL)){error=GetLastError();goto failed;}
  si.StartupInfo.cb=sizeof(si);si.StartupInfo.dwFlags=STARTF_USESTDHANDLES;
  si.StartupInfo.hStdInput=handles[0];si.StartupInfo.hStdOutput=handles[1];si.StartupInfo.hStdError=handles[2];si.lpAttributeList=attributes;
  stage="CreateProcess in job";
  if(!CreateProcessW(s[0],s[1],NULL,NULL,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,s[3],s[2],&si.StartupInfo,&pi)){error=GetLastError();goto failed;}
  BOOL member=FALSE;stage="creation membership";
  if(!IsProcessInJob(pi.hProcess,job,&member)||!member){error=GetLastError();goto failed;}
  Group *g=calloc(1,sizeof(Group));stage="live handle";if(!g){error=ERROR_NOT_ENOUGH_MEMORY;goto failed;}
  g->job=job;g->root=pi.hProcess;g->pid=pi.dwProcessId;g->env=env;g->next=groups;groups=g;
  if(napi_create_external(env,g,finalize,NULL,&result)!=0){finalize(env,g,NULL);job=NULL;pi.hProcess=NULL;goto failed;}
  stage="ResumeThread";
  if(ResumeThread(pi.hThread)==(DWORD)-1){error=GetLastError();close_group(g);job=NULL;pi.hProcess=NULL;goto failed;}
  job=NULL;pi.hProcess=NULL;goto done;
failed:
  if(job) CloseHandle(job);
  if(pi.hProcess) CloseHandle(pi.hProcess);
  result=fail(env,stage,error);
done:
  if(pi.hThread)CloseHandle(pi.hThread);
  if(attributesReady) DeleteProcThreadAttributeList(attributes);
  free(attributes);
  for(int i=0;i<3;i++)if(handles[i]&&handles[i]!=INVALID_HANDLE_VALUE)CloseHandle(handles[i]);
  for(int i=0;i<6;i++) free(s[i]);
  return result;
}
static napi_value inspect(napi_env env,napi_callback_info info) {
  Group *g=argument(env,info);if(!g)return fail(env,"live group identity",ERROR_INVALID_HANDLE);
  napi_value result,list;napi_create_object(env,&result);napi_create_array(env,&list);
  number(env,result,"launcherPid",g->pid);number(env,result,"closed",g->job?0:1);if(!g->job)return result;
  number(env,result,"launcherCreatedAt",created(g->root));DWORD code=0;
  if(WaitForSingleObject(g->root,0)==WAIT_OBJECT_0&&GetExitCodeProcess(g->root,&code))number(env,result,"exitCode",code);
  else{napi_value nil;napi_get_null(env,&nil);napi_set_named_property(env,result,"exitCode",nil);}
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};
  if(!QueryInformationJobObject(g->job,JobObjectExtendedLimitInformation,&limits,sizeof(limits),NULL))return fail(env,"inspect limits",GetLastError());
  number(env,result,"limitFlags",limits.BasicLimitInformation.LimitFlags);
  DWORD capacity=64;JOBOBJECT_BASIC_PROCESS_ID_LIST *members=NULL;
  for(;;){DWORD bytes=sizeof(*members)+(capacity-1)*sizeof(ULONG_PTR);members=calloc(1,bytes);
    if(!members)return fail(env,"inspect allocation",ERROR_NOT_ENOUGH_MEMORY);
    if(QueryInformationJobObject(g->job,JobObjectBasicProcessIdList,members,bytes,NULL))break;
    DWORD err=GetLastError();free(members);members=NULL;
    if(err!=ERROR_MORE_DATA||capacity>=65536) return fail(env,"inspect members",err);
    capacity*=2;}
  uint32_t index=0;
  for(DWORD i=0;i<members->NumberOfProcessIdsInList;i++){
    DWORD pid=(DWORD)members->ProcessIdList[i];HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);BOOL member=FALSE;
    /* Enumerated PIDs are diagnostic only. Recheck the opened handle's job
     * membership so PID reuse cannot be mistaken for live ownership. */
    if(!p)continue;
    if(IsProcessInJob(p,g->job,&member)&&member){napi_value row;napi_create_object(env,&row);number(env,row,"pid",pid);number(env,row,"createdAt",created(p));
      wchar_t file[32768];DWORD len=32768;if(QueryFullProcessImageNameW(p,0,file,&len)){napi_value path;napi_create_string_utf16(env,(char16_t*)file,len,&path);napi_set_named_property(env,row,"file",path);}
      napi_set_element(env,list,index++,row);}
    CloseHandle(p);
  }
  free(members);napi_set_named_property(env,result,"members",list);return result;
}
static napi_value close_owned(napi_env env,napi_callback_info info){Group *g=argument(env,info);if(!g)return fail(env,"live group identity",ERROR_INVALID_HANDLE);close_group(g);napi_value result;napi_get_null(env,&result);return result;}
/* Supplemental Task Stop: acquire once, verify birth/image on that handle,
 * and terminate the SAME handle. PID reuse between enumeration and acquisition
 * is refused; reuse after acquisition cannot retarget an open kernel handle.
 * This never changes held Git job ownership or reconstructs an old job. */
static napi_value terminate_verified(napi_env env,napi_callback_info info) {
  napi_value values[3],result=NULL;size_t count=3,n[3];wchar_t *s[3]={0},*end=NULL;
  HANDLE handle=NULL;DWORD error=ERROR_INVALID_PARAMETER;const char *stage="process identity arguments";
  if(napi_get_cb_info(env,info,&count,values,NULL,NULL)!=0||count!=3)return fail(env,stage,error);
  for(int i=0;i<3;i++){s[i]=string(env,values[i],&n[i]);if(!s[i]||!n[i]||wcslen(s[i])!=n[i])goto done;}
  unsigned long pid=wcstoul(s[0],&end,10);if(!pid||*end||pid==GetCurrentProcessId())goto done;
  double birth=wcstod(s[1],&end);if(*end||birth<=0||birth>9007199254740991.0)goto done;
  if(wcschr(s[2],L'\\')||wcschr(s[2],L'/'))goto done;
  stage="current process handle";handle=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_TERMINATE|SYNCHRONIZE,FALSE,(DWORD)pid);
  if(!handle){error=GetLastError();goto done;}
  stage="current process lifetime/image";
  wchar_t file[32768];DWORD len=32768;
  if(created(handle)!=birth||!QueryFullProcessImageNameW(handle,0,file,&len)){error=ERROR_INVALID_DATA;goto done;}
  wchar_t *name=wcsrchr(file,L'\\');name=name?name+1:file;
  if(_wcsicmp(name,s[2])){error=ERROR_INVALID_DATA;goto done;}
  DWORD wait=WaitForSingleObject(handle,0);
  if(wait==WAIT_OBJECT_0){napi_get_null(env,&result);goto done;}
  if(wait!=WAIT_TIMEOUT){error=GetLastError();goto done;}
  stage="identity-verified handle termination";
  if(!TerminateProcess(handle,1)){error=GetLastError();goto done;}
  if(WaitForSingleObject(handle,1500)!=WAIT_OBJECT_0){error=ERROR_TIMEOUT;goto done;}
  napi_get_null(env,&result);
done:
  if(handle)CloseHandle(handle);
  for(int i=0;i<3;i++)free(s[i]);
  return result?result:fail(env,stage,error);
}
__declspec(dllexport) int32_t node_api_module_get_api_version_v1(void){return 8;}
__declspec(dllexport) napi_value napi_register_module_v1(napi_env env,napi_value exports){
  HMODULE node=GetModuleHandleW(NULL);
#define LOAD(name) do{FARPROC address=GetProcAddress(node,#name);memcpy(&name,&address,sizeof(name));if(!name)return NULL;}while(0)
  LOAD(napi_get_cb_info);LOAD(napi_get_value_string_utf16);LOAD(napi_get_value_external);LOAD(napi_create_external);
  LOAD(napi_create_function);LOAD(napi_set_named_property);LOAD(napi_create_object);LOAD(napi_create_array);LOAD(napi_set_element);
  LOAD(napi_create_double);LOAD(napi_create_string_utf16);LOAD(napi_get_null);LOAD(napi_throw_error);LOAD(napi_add_env_cleanup_hook);
  const char *names[]={"launch","inspect","close","terminateVerified"};napi_callback callbacks[]={launch,inspect,close_owned,terminate_verified};
  for(int i=0;i<4;i++){napi_value fn;napi_create_function(env,names[i],(size_t)-1,callbacks[i],NULL,&fn);napi_set_named_property(env,exports,names[i],fn);}
  napi_add_env_cleanup_hook(env,cleanup,env);return exports;
}

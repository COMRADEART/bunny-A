/* Windows x64, Node-API v8. No Node/V8 C++ ABI or third-party runtime.
 * Stable C signatures: https://nodejs.org/api/n-api.html . Resolve only the
 * documented exports from node.exe. A PID alone never confers authority.
 */
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdbool.h>
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
API(napi_is_buffer,(napi_env,napi_value,bool*));
API(napi_get_buffer_info,(napi_env,napi_value,void**,size_t*));
API(napi_get_value_bool,(napi_env,napi_value,bool*));
/* T9R-F04: after configuration the Host keeps only these job rights. Limits
 * (KILL_ON_JOB_CLOSE, no breakaway) cannot be changed through this handle. */
#define OWNED_JOB_ACCESS (JOB_OBJECT_ASSIGN_PROCESS|JOB_OBJECT_QUERY|JOB_OBJECT_TERMINATE)
#define MAX_INPUT (64u*1024u*1024u)
typedef struct Group { HANDLE job,root,writer,input;size_t inputWritten;DWORD pid;napi_env env;struct Group *next; } Group;
#define MAX_INTERACTIVE_INPUT (512u*1024u)
typedef struct Input { HANDLE pipe;char *data;size_t size; } Input;
static Group *groups;
static napi_value fail(napi_env env,const char *stage,DWORD error) {
  char message[192];snprintf(message,sizeof(message),"Windows ownership failed closed at %s (Win32 %lu).",stage,(unsigned long)error);
  napi_throw_error(env,"BUNNY_JOB_FAILED",message);return NULL;
}
/* Owns its anonymous pipe end and buffer. A broken pipe (reader terminated)
 * ends it; it never touches the Group, which may be freed first. */
static DWORD WINAPI write_input(void *parameter) {
  Input *input=parameter;size_t offset=0;
  while(offset<input->size){
    DWORD written=0,chunk=(DWORD)((input->size-offset)>1048576?1048576:(input->size-offset));
    if(!WriteFile(input->pipe,input->data+offset,chunk,&written,NULL)||!written)break;
    offset+=written;
  }
  CloseHandle(input->pipe);free(input->data);free(input);return 0;
}
static DWORD active_processes(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION account;
  if(!QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&account,sizeof(account),NULL))return (DWORD)-1;
  return account.ActiveProcesses;
}
/* Terminates every member (descendants of exited parents included) and waits
 * a bounded time for kernel accounting to reach zero. Keeps the handle. */
static DWORD terminate_group(Group *g,DWORD wait) {
  if(!g->job)return 0;
  TerminateJobObject(g->job,1);
  ULONGLONG deadline=GetTickCount64()+wait;DWORD active;
  while((active=active_processes(g->job))&&GetTickCount64()<deadline) Sleep(2);
  return active;
}
static DWORD close_group(Group *g) {
  /* Host holds the sole non-inheritable job handle. Closure kills ALL members,
   * including descendants whose immediate parent has already exited. */
  DWORD active=0;
  if(g->job){active=terminate_group(g,1500);CloseHandle(g->job);g->job=NULL;}
  if(g->input){CloseHandle(g->input);g->input=NULL;}
  if(g->writer){
    /* Readers are dead, so WriteFile fails with a broken pipe. A writer that has not yet entered WriteFile cannot be
     * cancelled, so cancellation repeats until the thread has exited (bounded). */
    for(int attempt=0;attempt<20&&WaitForSingleObject(g->writer,attempt?100:1500)!=WAIT_OBJECT_0;attempt++) CancelSynchronousIo(g->writer);
    CloseHandle(g->writer);g->writer=NULL;
  }
  if(g->root){CloseHandle(g->root);g->root=NULL;}
  return active;
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
  napi_value values[7],result=NULL;size_t count=7,n[6];wchar_t *s[6]={0};
  HANDLE job=NULL,handles[3]={NULL,NULL,NULL},input=NULL,writer=NULL;LPPROC_THREAD_ATTRIBUTE_LIST attributes=NULL;BOOL attributesReady=FALSE;
  PROCESS_INFORMATION pi={0};STARTUPINFOEXW si={0};DWORD error=ERROR_INVALID_PARAMETER;const char *stage="arguments";
  Input *payload=NULL;Group *g=NULL;
  if(napi_get_cb_info(env,info,&count,values,NULL,NULL)!=0||(count!=6&&count!=7))return fail(env,stage,error);
  for(int i=0;i<6;i++){s[i]=string(env,values[i],&n[i]);if(!s[i]||(i!=3&&wcslen(s[i])!=n[i]))goto failed;}
  if(!n[0]||!n[1]||n[1]>=32767||!n[2]||n[3]<2||s[3][n[3]-1]||s[3][n[3]-2])goto failed;
  bool interactive=false;
  /* T9R-F04: a Buffer is the provider prompt, copied now and delivered over an unnamed pipe by a Host
   * thread only after the contained root resumes (no name to squat). `true` keeps the Host writer end
   * for a bounded JSON-RPC probe. */
  if(count==7){bool flag=false;stage="input";if(napi_get_value_bool(env,values[6],&flag)==0){if(!flag)goto failed;interactive=true;}}
  if(count==7&&!interactive){
    bool isBuffer=false;stage="input buffer";void *data=NULL;size_t size=0;
    if(napi_is_buffer(env,values[6],&isBuffer)!=0||!isBuffer||napi_get_buffer_info(env,values[6],&data,&size)!=0||size>MAX_INPUT)goto failed;
    payload=calloc(1,sizeof(Input));if(!payload){error=ERROR_NOT_ENOUGH_MEMORY;goto failed;}
    payload->data=malloc(size?size:1);if(!payload->data){error=ERROR_NOT_ENOUGH_MEMORY;goto failed;}
    if(size)memcpy(payload->data,data,size);
    payload->size=size;
  }
  stage="CreateJobObject";job=CreateJobObjectW(NULL,NULL);if(!job){error=GetLastError();goto failed;}
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  stage="job limits";if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))){error=GetLastError();goto failed;}
  HANDLE reduced=NULL;stage="job access reduction";
  if(!DuplicateHandle(GetCurrentProcess(),job,GetCurrentProcess(),&reduced,OWNED_JOB_ACCESS,FALSE,0)){error=GetLastError();goto failed;}
  CloseHandle(job);job=reduced;
  SECURITY_ATTRIBUTES security={sizeof(SECURITY_ATTRIBUTES),NULL,TRUE};stage="stdio";
  if(payload||interactive){
    if(!CreatePipe(&handles[0],&input,NULL,interactive?MAX_INTERACTIVE_INPUT:0)){error=GetLastError();handles[0]=NULL;input=NULL;goto failed;}
    if(!SetHandleInformation(handles[0],HANDLE_FLAG_INHERIT,HANDLE_FLAG_INHERIT)){error=GetLastError();goto failed;}
  } else handles[0]=CreateFileW(L"NUL",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,&security,OPEN_EXISTING,0,NULL);
  for(int i=1;i<3;i++)handles[i]=CreateFileW(s[i+3],GENERIC_WRITE,0,&security,OPEN_EXISTING,SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,NULL);
  for(int i=0;i<3;i++)if(handles[i]==INVALID_HANDLE_VALUE){error=GetLastError();goto failed;}
  SIZE_T bytes=0;InitializeProcThreadAttributeList(NULL,2,0,&bytes);attributes=malloc(bytes);stage="startup attributes";
  if(!attributes||!InitializeProcThreadAttributeList(attributes,2,0,&bytes)){error=GetLastError();goto failed;}attributesReady=TRUE;
  /* Windows 10+ JOB_LIST assigns ownership atomically during CreateProcess.
   * Death before ResumeThread cannot orphan the root. HANDLE_LIST inherits
   * ONLY stdio: never job/root/input-writer/other Host handles. No breakaway. */
  if(!UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,sizeof(handles),NULL,NULL)||
     !UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job,sizeof(job),NULL,NULL)){error=GetLastError();goto failed;}
  si.StartupInfo.cb=sizeof(si);si.StartupInfo.dwFlags=STARTF_USESTDHANDLES;
  si.StartupInfo.hStdInput=handles[0];si.StartupInfo.hStdOutput=handles[1];si.StartupInfo.hStdError=handles[2];si.lpAttributeList=attributes;
  stage="CreateProcess in job";
  if(!CreateProcessW(s[0],s[1],NULL,NULL,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,s[3],s[2],&si.StartupInfo,&pi)){error=GetLastError();goto failed;}
  BOOL member=FALSE;stage="creation membership";
  if(!IsProcessInJob(pi.hProcess,job,&member)){error=GetLastError();TerminateProcess(pi.hProcess,1);goto failed;}
  if(!member){error=ERROR_ACCESS_DENIED;TerminateProcess(pi.hProcess,1);goto failed;}
  g=calloc(1,sizeof(Group));stage="live handle";if(!g){error=ERROR_NOT_ENOUGH_MEMORY;TerminateProcess(pi.hProcess,1);goto failed;}
  g->job=job;g->root=pi.hProcess;g->pid=pi.dwProcessId;g->env=env;g->next=groups;groups=g;
  job=NULL;pi.hProcess=NULL;
  if(napi_create_external(env,g,finalize,NULL,&result)!=0){finalize(env,g,NULL);g=NULL;result=NULL;goto failed;}
  /* Every failure below happens before the root runs: the prompt writer is created suspended first, so a
   * refused launch never executed provider code (T9R-F04 review round 2, L4). */
  if(payload){
    stage="input writer";payload->pipe=input;
    writer=CreateThread(NULL,0,write_input,payload,CREATE_SUSPENDED,NULL);
    if(!writer){error=GetLastError();payload->pipe=NULL;close_group(g);result=NULL;goto failed;}
    g->writer=writer;input=NULL;payload=NULL;
  } else if(interactive){g->input=input;input=NULL;}
  /* The writer runs first (the pipe buffers until the root reads), so its failure also precedes the root (round 3). */
  if(g->writer&&ResumeThread(g->writer)==(DWORD)-1){error=GetLastError();stage="input writer resume";close_group(g);result=NULL;goto failed;}
  stage="ResumeThread";
  if(ResumeThread(pi.hThread)==(DWORD)-1){error=GetLastError();close_group(g);result=NULL;goto failed;}
  goto done;
failed:
  if(job) CloseHandle(job);
  if(pi.hProcess) CloseHandle(pi.hProcess);
  result=fail(env,stage,error);
done:
  if(input) CloseHandle(input);
  if(payload){free(payload->data);free(payload);}
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
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION account;
  if(!QueryInformationJobObject(g->job,JobObjectBasicAccountingInformation,&account,sizeof(account),NULL))return fail(env,"inspect accounting",GetLastError());
  number(env,result,"activeProcesses",account.ActiveProcesses);number(env,result,"totalProcesses",account.TotalProcesses);
  number(env,result,"totalTerminatedProcesses",account.TotalTerminatedProcesses);
  DWORD capacity=64;JOBOBJECT_BASIC_PROCESS_ID_LIST *members=NULL;
  for(;;){DWORD bytes=sizeof(*members)+(capacity-1)*sizeof(ULONG_PTR);members=calloc(1,bytes);
    if(!members)return fail(env,"inspect allocation",ERROR_NOT_ENOUGH_MEMORY);
    if(QueryInformationJobObject(g->job,JobObjectBasicProcessIdList,members,bytes,NULL))break;
    DWORD err=GetLastError();free(members);members=NULL;
    if(err!=ERROR_MORE_DATA||capacity>=65536) return fail(env,"inspect members",err);
    capacity*=2;}
  uint32_t index=0,unverified=0;
  for(DWORD i=0;i<members->NumberOfProcessIdsInList;i++){
    DWORD pid=(DWORD)members->ProcessIdList[i];HANDLE p=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);BOOL member=FALSE;
    /* Enumerated PIDs are diagnostic only. Recheck the opened handle's job
     * membership so PID reuse cannot be mistaken for live ownership. */
    /* A listed member that cannot be opened or re-verified is counted, never silently dropped (round 3). */
    if(!p){unverified++;continue;}
    if(!IsProcessInJob(p,g->job,&member)||!member)unverified++;
    else{napi_value row;napi_create_object(env,&row);number(env,row,"pid",pid);number(env,row,"createdAt",created(p));
      wchar_t file[32768];DWORD len=32768;if(QueryFullProcessImageNameW(p,0,file,&len)){napi_value path;napi_create_string_utf16(env,(char16_t*)file,len,&path);napi_set_named_property(env,row,"file",path);}
      napi_set_element(env,list,index++,row);}
    CloseHandle(p);
  }
  free(members);napi_set_named_property(env,result,"members",list);number(env,result,"unverifiedMembers",unverified);return result;
}
static napi_value close_owned(napi_env env,napi_callback_info info){Group *g=argument(env,info);if(!g)return fail(env,"live group identity",ERROR_INVALID_HANDLE);DWORD active=close_group(g);napi_value result;napi_create_object(env,&result);number(env,result,"activeProcesses",active==(DWORD)-1?-1:(double)active);return result;}
/* T9R-F04 interactive stdin (bounded JSON-RPC probes only). The pipe buffer is sized to the whole budget, so a
 * synchronous write never blocks the Host waiting for a reader. */
static napi_value write_input_owned(napi_env env,napi_callback_info info){
  size_t count=2;napi_value values[2];void *pointer=NULL,*data=NULL;size_t size=0;bool isBuffer=false;
  if(napi_get_cb_info(env,info,&count,values,NULL,NULL)!=0||count!=2||napi_get_value_external(env,values[0],&pointer)!=0)return fail(env,"input arguments",ERROR_INVALID_PARAMETER);
  Group *g=NULL;for(Group *row=groups;row;row=row->next)if(row==pointer&&row->env==env)g=row;
  if(!g||!g->job||!g->input)return fail(env,"interactive input",ERROR_INVALID_HANDLE);
  if(napi_is_buffer(env,values[1],&isBuffer)!=0||!isBuffer||napi_get_buffer_info(env,values[1],&data,&size)!=0||size>MAX_INTERACTIVE_INPUT-g->inputWritten)return fail(env,"interactive input budget",ERROR_INVALID_PARAMETER);
  size_t offset=0;
  while(offset<size){DWORD written=0;BOOL ok=WriteFile(g->input,(char*)data+offset,(DWORD)(size-offset),&written,NULL);g->inputWritten+=written;offset+=written;if(!ok||!written)return fail(env,"interactive input write",GetLastError());}napi_value result;napi_get_null(env,&result);return result;
}
static napi_value end_input_owned(napi_env env,napi_callback_info info){Group *g=argument(env,info);if(!g)return fail(env,"live group identity",ERROR_INVALID_HANDLE);if(g->input){CloseHandle(g->input);g->input=NULL;}napi_value result;napi_get_null(env,&result);return result;}
/* T9R-F04 Stop: terminate every member and report kernel accounting at once
 * (never blocks the Host thread; JS polls). The handle stays open, so an
 * unconfirmed termination can still be observed and retried. */
static napi_value terminate_owned(napi_env env,napi_callback_info info){Group *g=argument(env,info);if(!g)return fail(env,"live group identity",ERROR_INVALID_HANDLE);if(!g->job)return fail(env,"closed group",ERROR_INVALID_HANDLE);DWORD active=terminate_group(g,0);napi_value result;napi_create_object(env,&result);number(env,result,"activeProcesses",active==(DWORD)-1?-1:(double)active);return result;}
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
  LOAD(napi_create_double);LOAD(napi_create_string_utf16);LOAD(napi_get_null);LOAD(napi_throw_error);LOAD(napi_add_env_cleanup_hook);LOAD(napi_is_buffer);LOAD(napi_get_buffer_info);LOAD(napi_get_value_bool);
  const char *names[]={"launch","inspect","close","terminate","terminateVerified","write","endInput"};napi_callback callbacks[]={launch,inspect,close_owned,terminate_owned,terminate_verified,write_input_owned,end_input_owned};
  for(int i=0;i<7;i++){napi_value fn;napi_create_function(env,names[i],(size_t)-1,callbacks[i],NULL,&fn);napi_set_named_property(env,exports,names[i],fn);}
  napi_add_env_cleanup_hook(env,cleanup,env);return exports;
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using HarmonyLib;

internal sealed class PclPromptException:Exception {}
internal sealed class AuthRuntime {
 const BindingFlags Static=BindingFlags.Static|BindingFlags.Public|BindingFlags.NonPublic;
 const string Owner="zhumeng.pcl.presentation.v2";
 readonly Assembly assembly;readonly Type launch,main;readonly AuthEvents events;readonly CancellationToken cancel;
 internal static int ActiveCalls;
 internal AuthRuntime(string path,AuthEvents output,CancellationToken token){
  events=output;cancel=token;assembly=Assembly.LoadFrom(path);
  var resources=new System.Resources.ResourceManager("PCL.Resources",assembly);
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,args)=>{
   var n=new AssemblyName(args.Name).Name;if(n!="MeloongCore"&&n!="MeloongCore.Wpf"&&n!="Newtonsoft.Json"&&n!="PCLCS"&&n!="ThrottleDebounce"&&n!="CacheCow.Client"&&n!="CacheCow.Client.FileStore"&&n!="CacheCow.Common")return null;
   var b=resources.GetObject(n) as byte[];if(b==null)throw new BridgeFailure("unsupported");return Assembly.Load(b);
  };
  // Logging facade is presentation-only. Patch explicitly named, void overloads.
  var core=Assembly.Load((byte[])resources.GetObject("MeloongCore"));var logger=core.GetType("MeloongCore.Logger",true);
  var harmony=new Harmony(Owner);
  var signatures=new HashSet<string>(new[]{
   "Void Log(System.String, MeloongCore.LogLevel, MeloongCore.LogBehavior, System.String)",
   "Void Log(System.Exception, System.String, MeloongCore.LogLevel, MeloongCore.LogBehavior, System.String)",
   "Void Log(System.Func`1[System.String], MeloongCore.LogLevel, MeloongCore.LogBehavior, System.String)",
   "Void Log(MeloongCore.LogLevel, LogInterpolatedStringHandler ByRef, MeloongCore.LogBehavior, System.String)",
   "Void Info(System.String, MeloongCore.LogBehavior, System.String)",
   "Void Info(System.Exception, System.String, MeloongCore.LogBehavior, System.String)",
   "Void Info(System.Func`1[System.String], MeloongCore.LogBehavior, System.String)",
   "Void Info(LogInterpolatedStringHandler`1 ByRef, MeloongCore.LogBehavior, System.String)",
   "Void Warn(System.String, MeloongCore.LogBehavior, System.String)",
   "Void Warn(System.Exception, System.String, MeloongCore.LogBehavior, System.String)",
   "Void Warn(System.Func`1[System.String], MeloongCore.LogBehavior, System.String)",
   "Void Warn(LogInterpolatedStringHandler`1 ByRef, MeloongCore.LogBehavior, System.String)",
   "Void Error(System.String, MeloongCore.LogBehavior, System.String)",
   "Void Error(System.Exception, System.String, MeloongCore.LogBehavior, System.String)",
   "Void Error(System.Func`1[System.String], MeloongCore.LogBehavior, System.String)",
   "Void Error(LogInterpolatedStringHandler`1 ByRef, MeloongCore.LogBehavior, System.String)"
  },StringComparer.Ordinal);
  foreach(var name in new[]{"Log","Info","Warn","Debug","Error"}){
   foreach(var method in logger.GetMethods(Static).Where(m=>m.Name==name)){
    if(method.ReturnType!=typeof(void)||method.IsGenericMethod||!signatures.Remove(method.ToString()))throw new BridgeFailure("unsupported");
    Patch(harmony,method,"Discard");
#if BRIDGE_TESTS
    events.Emit("progress",new Dictionary<string,object>{{"testHook",method.ToString()}});
#endif
   }
  }
  if(signatures.Count!=0)throw new BridgeFailure("unsupported");
  launch=assembly.GetType("PCL.ModLaunch",true);main=assembly.GetType("PCL.ModMain",true);
  var modBase=assembly.GetType("PCL.ModBase",true);
  Patch(harmony,launch.GetMethod("McLaunchLog",Static),"Discard");
  Patch(harmony,modBase.GetMethod("OpenWebsite",Static,null,new[]{typeof(string)},null),"RejectPrompt");
  var prompt=main.GetMethod("MyMsgBox",Static);
  if(prompt==null||prompt.ReturnType!=typeof(int)||prompt.GetParameters().Length!=11)throw new BridgeFailure("unsupported");
  Patch(harmony,prompt,"RejectPrompt");
  foreach(var t in new[]{modBase,main,launch})RuntimeHelpers.RunClassConstructor(t.TypeHandle);
  foreach(var name in new[]{"PathExe","PathTemp"}){
   var privatePath=(string)modBase.GetField(name).GetValue(null);
   if(!Path.GetFullPath(privatePath).StartsWith(AppDomain.CurrentDomain.BaseDirectory,StringComparison.OrdinalIgnoreCase))throw new BridgeFailure("unsupported");
  }
  // Actual target method gate: the prefix must throw before its original fallback can run.
  var queue=main.GetField("WaitingMyMsgBox").GetValue(null);int before=Count(queue);
  bool rejected=false;
  try{prompt.Invoke(null,new object[]{"owned synthetic prompt","owned synthetic title","accept","cancel","",false,true,false,null,null,null});}
  catch(TargetInvocationException e){rejected=e.InnerException is PclPromptException;}
  if(!rejected||Count(queue)!=before)throw new BridgeFailure("unsupported");
  events.Progress("presentation_gate_passed");
 }
 static bool Discard(){return false;}
 static void RejectPrompt(){throw new PclPromptException();}
 static void Patch(Harmony h,MethodInfo target,string prefix){
  if(target==null)throw new BridgeFailure("unsupported");
  var p=typeof(AuthRuntime).GetMethod(prefix,Static);h.Patch(target,new HarmonyMethod(p));
  var info=Harmony.GetPatchInfo(target);
  if(info==null||info.Prefixes.Count(x=>x.owner==Owner&&x.PatchMethod==p)!=1||info.Owners.Any(x=>x!=Owner))throw new BridgeFailure("unsupported");
 }
 static int Count(object queue){return (int)queue.GetType().GetProperty("Count").GetValue(queue,null);}
 object Call(string name,object input){cancel.ThrowIfCancellationRequested();events.Progress(name);Interlocked.Increment(ref ActiveCalls);try{return launch.GetMethod(name,Static).Invoke(null,new[]{input});}catch(TargetInvocationException e){ExceptionDispatchInfo.Capture(e.InnerException).Throw();throw;}finally{Interlocked.Decrement(ref ActiveCalls);}}
 internal void SyntheticPrompt(){try{main.GetMethod("MyMsgBox",Static).Invoke(null,new object[]{"owned synthetic prompt","owned title","accept","cancel","",false,true,false,null,null,null});}catch(TargetInvocationException e){throw e.InnerException;}throw new BridgeFailure("unsupported");}
 static string Item(object tuple,int index){return (string)tuple.GetType().GetField("Item"+index).GetValue(tuple);}
 internal Dictionary<string,object> Authenticate(AuthRequest request){
  object pair;
  if(request.Command=="refresh")pair=Call("MsLoginStep1Refresh",request.Refresh);
  else {
   object result=null;Exception failure=null;
   var step=new Thread(()=>{try{result=Call("MsLoginStep1New",launch.GetField("McLoginMsLoader").GetValue(null));}catch(Exception e){failure=e;}}){IsBackground=true};
   step.Start();
   // This thread and Step1 both remain inside the process-local registry override.
   var queue=main.GetField("WaitingMyMsgBox").GetValue(null);
   while(step.IsAlive){
    cancel.ThrowIfCancellationRequested();object converter=null;
    var arguments=new object[]{null};
    if((bool)queue.GetType().GetMethod("TryDequeue").Invoke(queue,arguments))converter=arguments[0];
    if(converter!=null){
     var type=converter.GetType();var content=type.GetField("Content").GetValue(converter);
     if(content==null)throw new PclPromptException();
     var json=Parse(content.ToString());
     if(!json.ContainsKey("device_code")||!json.ContainsKey("user_code"))throw new PclPromptException();
     var tokens=Poll(json);
     // Actual pinned IL uses LateIndexGet(0), LateIndexGet(1), not ValueTuple fields.
     type.GetField("Result").SetValue(converter,new string[]{tokens[0],tokens[1]});
    }
    Thread.Sleep(20);
   }
   step.Join();if(failure!=null)ExceptionDispatchInfo.Capture(failure).Throw();pair=result;
  }
  var access=Item(pair,1);var refresh=Item(pair,2);if(String.IsNullOrEmpty(refresh))refresh=request.Refresh;
  var xbl=Call("MsLoginStep2",access);var xsts=Call("MsLoginStep3",xbl);
  var issuedAt=DateTime.UtcNow;var minecraft=Call("MsLoginStep4",xsts);
  var mcAccess=Item(minecraft,1);var ttl=(int)minecraft.GetType().GetField("Item2").GetValue(minecraft);
  var expiresAt=AuthTiming.Expiry(issuedAt,ttl);
  Call("MsLoginStep5",mcAccess);var profile=Call("MsLoginStep6",mcAccess);
  var metadata=Parse(Item(profile,3));
  cancel.ThrowIfCancellationRequested();
  return new Dictionary<string,object>{{"uuid",Item(profile,1)},{"name",Item(profile,2)},{"accessToken",mcAccess},{"refreshToken",refresh},{"expiresAt",expiresAt.ToString("o")},{"profile",metadata}};
 }
 static Dictionary<string,object> Parse(string json){try{return new JavaScriptSerializer{MaxJsonLength=65536,RecursionLimit=16}.DeserializeObject(json) as Dictionary<string,object>??throw new BridgeFailure("unsupported");}catch(BridgeFailure){throw;}catch{throw new BridgeFailure("unsupported");}}
 static string Text(Dictionary<string,object> d,string key){object v;if(!d.TryGetValue(key,out v)||!(v is string)||((string)v).Length==0||((string)v).Length>16384)throw new BridgeFailure("unsupported");return (string)v;}
 string[] Poll(Dictionary<string,object> device){
  var secret=Text(device,"device_code");var code=Text(device,"user_code");var uri=Text(device,"verification_uri");
  if(uri!="https://www.microsoft.com/link"&&uri!="https://microsoft.com/devicelogin"&&uri!="https://www.microsoft.com/devicelogin")throw new BridgeFailure("unsupported");
  int interval,ttl;try{interval=Convert.ToInt32(device["interval"]);ttl=Convert.ToInt32(device["expires_in"]);}catch{throw new BridgeFailure("unsupported");}
  if(interval<1||interval>60||ttl<1||ttl>1800||code.Length>32)throw new BridgeFailure("unsupported");
  var expiry=DateTime.UtcNow.AddSeconds(ttl);
  events.Emit("device",new Dictionary<string,object>{{"userCode",code},{"verificationUri",uri},{"expiresAt",expiry.ToString("o")},{"interval",interval}});
  var id=(string)assembly.GetType("PCL.ModSecret",true).GetField("OAuthClientId",Static).GetRawConstantValue();
  while(DateTime.UtcNow<expiry){
   if(cancel.WaitHandle.WaitOne(interval*1000))throw new OperationCanceledException();
   var body="grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id="+Uri.EscapeDataString(id)+"&device_code="+Uri.EscapeDataString(secret);
   var response=Post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token",body);
   object error;
   if(!response.TryGetValue("error",out error))return new[]{Text(response,"access_token"),Text(response,"refresh_token")};
   switch(error as string){case "authorization_pending":break;case "slow_down":interval=AuthTiming.SlowDown(interval);break;case "authorization_declined":throw new BridgeFailure("declined");case "expired_token":throw new BridgeFailure("expired");default:throw new BridgeFailure("network_error");}
  }
  throw new BridgeFailure("expired");
 }
 Dictionary<string,object> Post(string uri,string body){
  var request=(HttpWebRequest)WebRequest.Create(uri);request.Method="POST";request.ContentType="application/x-www-form-urlencoded";request.Timeout=15000;request.ReadWriteTimeout=15000;request.AllowAutoRedirect=false;
  using(cancel.Register(request.Abort)){
   var bytes=Encoding.UTF8.GetBytes(body);request.ContentLength=bytes.Length;
   using(var stream=request.GetRequestStream())stream.Write(bytes,0,bytes.Length);
   WebResponse response;try{response=request.GetResponse();}catch(WebException e){if(e.Response==null)throw new BridgeFailure("network_error");response=e.Response;}
   using(response)using(var reader=new StreamReader(response.GetResponseStream())){
    var b=new StringBuilder();var chunk=new char[1024];int read;while((read=reader.Read(chunk,0,chunk.Length))>0){if(b.Length+read>65536)throw new BridgeFailure("unsupported");b.Append(chunk,0,read);}return Parse(b.ToString());
   }
  }
 }
}

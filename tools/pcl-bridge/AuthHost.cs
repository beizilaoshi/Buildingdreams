using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

internal static class AuthHost {
 [DllImport("user32.dll")]static extern bool EnumWindows(WindowCallback callback,IntPtr param);
 delegate bool WindowCallback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 static bool WindowPresent(){bool found=false;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==(uint)System.Diagnostics.Process.GetCurrentProcess().Id&&IsWindowVisible(h))found=true;return true;},IntPtr.Zero);return found;}
 internal static int Run(){
  Console.SetOut(new StreamWriter(Console.OpenStandardOutput()){AutoFlush=true});Console.SetIn(new StreamReader(Console.OpenStandardInput()));
  AuthEvents events=null;AuthIsolation isolation=null;Thread auth=null;Timer heartbeat=null;var cancellation=new CancellationTokenSource();
  int exit=0;bool targetLoaded=false;
  try{
   var request=AuthRequest.Read(Console.In);if(request==null)throw new BridgeFailure("cancelled");events=new AuthEvents(request.Session);
   if(request.Command=="cancel")throw new BridgeFailure("cancelled");
   isolation=new AuthIsolation(request.Session);
   // Positive, flushed proof of this child's atomic create-new ownership.
   events.Emit("progress",new Dictionary<string,object>{{"registryOwned",true},{"registryOwner","zhumeng.pcl.auth.v2"}});
   heartbeat=new Timer(_=>events.Emit("heartbeat"),null,0,5000);
   var input=new Thread(()=>{
    try{while(true){var next=AuthRequest.Read(Console.In);if(next==null){events.End("cancelled");cancellation.Cancel();return;}if(next.Session!=request.Session||next.Command!="cancel"){events.End("unsupported");cancellation.Cancel();return;}events.End("cancelled");cancellation.Cancel();}}
    catch{events.End("unsupported");cancellation.Cancel();}
   }){IsBackground=true};input.Start();
   auth=new Thread(()=>{
    try{
     cancellation.Token.ThrowIfCancellationRequested();
     Volatile.Write(ref targetLoaded,true);
#if BRIDGE_TESTS
     var initMode=Environment.GetEnvironmentVariable("BRIDGE_TEST_AUTH");
     if(initMode=="init_cancel"||initMode=="init_eof"){events.Progress("test_init_wait");while(true)Thread.Sleep(1000);}
#endif
     // Target loading/static constructors run on a dedicated STA, never on the
     // cancellation supervisor or input thread. No dispatcher pumping/startup.
     var app=new System.Windows.Application{ShutdownMode=System.Windows.ShutdownMode.OnExplicitShutdown};
     var runtime=new AuthRuntime(isolation.Target,events,cancellation.Token);
     if(WindowPresent())throw new BridgeFailure("unsupported");
#if BRIDGE_TESTS
     var mode=Environment.GetEnvironmentVariable("BRIDGE_TEST_AUTH");
     if(mode=="prompt"){events.Stage="MsLoginStep5";runtime.SyntheticPrompt();}
     if(mode=="hung"||mode=="mismatch"||mode=="duplicate"){events.Progress("test_wait");while(true)Thread.Sleep(1000);}
     if(mode=="eof"){while(!cancellation.IsCancellationRequested)Thread.Sleep(10);throw new OperationCanceledException();}
#endif
     // Keep PCL's recorded UI-owner STA distinct from every network helper.
     Dictionary<string,object> result=null;Exception backendFailure=null;
     var backend=new Thread(()=>{try{result=runtime.Authenticate(request);}catch(Exception e){backendFailure=e;}}){IsBackground=true};
     backend.Start();backend.Join();
     if(backendFailure!=null)System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(backendFailure).Throw();
     cancellation.Token.ThrowIfCancellationRequested();events.Complete(result);
    }catch(Exception e){
#if BRIDGE_TESTS
     string diagnostic=e is NullReferenceException?"internal_null":e is TypeInitializationException?"initialization_failed":e is System.Net.WebException?"transport_failed":e is System.AggregateException?"aggregate_failed":e is MissingMethodException?"method_missing":e is System.IO.FileNotFoundException?"dependency_missing":e is InvalidOperationException?"invalid_operation":e is PclPromptException?"prompt_rejected":"other_failure";
     if(e is System.IO.FileNotFoundException){try{var name=new System.Reflection.AssemblyName(((System.IO.FileNotFoundException)e).FileName).Name;foreach(var known in new[]{"System.Net.Http","Microsoft.VisualBasic","System.ValueTuple","Newtonsoft.Json","MeloongCore","MeloongCore.Wpf","PCLCS","NAudio","ThrottleDebounce","CacheCow.Client.FileStore","CacheCow.Client","CacheCow.Common","Imazen.WebP"})if(name==known)diagnostic="dependency_"+known.Replace('.','_');}catch{}}
     if(e is NullReferenceException&&e.TargetSite!=null)foreach(var known in new[]{"SecretCdnSign","SecretHeadersSign","NetRequestByClient","SendRequest","MsLoginStep1New","GetTimeMs","DeserializeJson","Call"})if(e.TargetSite.Name==known)diagnostic="null_"+known;
     if(e is NullReferenceException&&e.TargetSite!=null){var type=e.TargetSite.DeclaringType;if(type==typeof(AuthRuntime))diagnostic="null_bridge_runtime";else if(type!=null&&type.Assembly==typeof(AuthHost).Assembly)diagnostic="null_bridge_host";else if(type!=null&&type.FullName.StartsWith("PCL."))diagnostic="null_pcl_native";else if(type==null)diagnostic="null_dynamic_hook";}
     events.Emit("progress",new Dictionary<string,object>{{"testCode",diagnostic}});
#endif
     string code=e is OperationCanceledException?(events.Stage=="MsLoginStep6"&&!cancellation.IsCancellationRequested?"profile_required":"cancelled"):e is BridgeFailure?((BridgeFailure)e).Code:e is PclPromptException?(events.Stage=="MsLoginStep5"?"unlicensed":events.Stage=="MsLoginStep6"?"profile_required":"account_action_required"):"network_error";
     events.End(code);
    }
   }){IsBackground=true};auth.SetApartmentState(ApartmentState.STA);auth.Start();
   while(auth.IsAlive&&!cancellation.IsCancellationRequested){if(WindowPresent()){events.End("unsupported");cancellation.Cancel();break;}Thread.Sleep(20);}
   if(!auth.Join(250)||Volatile.Read(ref AuthRuntime.ActiveCalls)>0){
    events.End("cancelled");heartbeat.Dispose();events.Emit("cleanup",new Dictionary<string,object>{{"code","parent_required"}});
    // Target may still execute: retain override and hooks until this process dies.
    Environment.Exit(32);
   }
  }catch(Exception e){if(events==null)events=new AuthEvents(Guid.Empty.ToString("D"));events.End(e is BridgeFailure?((BridgeFailure)e).Code:"unsupported");exit=20;}
  finally{
   if(heartbeat!=null)heartbeat.Dispose();
   // Target static constructors may own additional background work. Preserve the
   // process-local override through OS teardown on ALL post-load paths; parent
   // deletes its exact nonce root only after observing child exit.
   if(Volatile.Read(ref targetLoaded)){events.Emit("cleanup",new Dictionary<string,object>{{"code","parent_required"}});Environment.Exit(exit);}
   // Auth can only be live here if initialization threw after starting it.
   if((auth!=null&&auth.IsAlive)||Volatile.Read(ref AuthRuntime.ActiveCalls)>0){events.Emit("cleanup",new Dictionary<string,object>{{"code","parent_required"}});Environment.Exit(32);}
   try{if(isolation!=null)isolation.Dispose();events.Emit("cleanup",new Dictionary<string,object>{{"code","complete"}});}catch{events.Emit("cleanup",new Dictionary<string,object>{{"code","failed"}});exit=31;}
  }
  return exit;
 }
}

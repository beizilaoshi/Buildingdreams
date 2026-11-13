using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Program {
 const string Pin="0DB34E19D9EEB6D496D20FABE786EC16BBD36BA6B0CCDC8D29CB7E909C114397";
 static readonly IntPtr HKCU=new IntPtr(unchecked((int)0x80000001));
 static readonly object OutputLock=new object();
 [DllImport("advapi32.dll", EntryPoint="RegCreateKeyEx", CharSet=CharSet.Unicode)] static extern int NativeRegCreateKeyEx(IntPtr h,string s,int reserved,string cls,int options,int access,IntPtr security,out IntPtr result,out int disposition);
 [DllImport("advapi32.dll",EntryPoint="RegOverridePredefKey")] static extern int NativeRegOverridePredefKey(IntPtr h,IntPtr mapped);
 [DllImport("advapi32.dll",EntryPoint="RegCloseKey")] static extern int NativeRegCloseKey(IntPtr h);
 [DllImport("advapi32.dll",EntryPoint="RegDeleteTree",CharSet=CharSet.Unicode)] static extern int NativeRegDeleteTree(IntPtr h,string s);
 [DllImport("advapi32.dll",EntryPoint="RegSetValueEx",CharSet=CharSet.Unicode)] static extern int NativeRegSetValueEx(IntPtr h,string name,int reserved,int type,byte[] data,int size);
 [DllImport("advapi32.dll",EntryPoint="RegQueryValueEx",CharSet=CharSet.Unicode)] static extern int NativeRegQueryValueEx(IntPtr h,string name,IntPtr reserved,out int type,byte[] data,ref int size);
 [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback cb,IntPtr param);
 delegate bool WindowCallback(IntPtr hwnd,IntPtr param);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
 static int RegistryCalls;
 static int RegCreateKeyEx(IntPtr h,string s,int r,string c,int o,int a,IntPtr sec,out IntPtr result,out int d){RegistryCalls++;return NativeRegCreateKeyEx(h,s,r,c,o,a,sec,out result,out d);}
 static int RegOverridePredefKey(IntPtr h,IntPtr m){RegistryCalls++;return NativeRegOverridePredefKey(h,m);}
 static int RegCloseKey(IntPtr h){RegistryCalls++;return NativeRegCloseKey(h);}
 static int RegDeleteTree(IntPtr h,string s){RegistryCalls++;return NativeRegDeleteTree(h,s);}
 static int RegSetValueEx(IntPtr h,string n,int r,int t,byte[] b,int z){RegistryCalls++;return NativeRegSetValueEx(h,n,r,t,b,z);}
 static int RegQueryValueEx(IntPtr h,string n,IntPtr r,out int t,byte[] b,ref int z){RegistryCalls++;return NativeRegQueryValueEx(h,n,r,out t,b,ref z);}
 static void Inject(string point){
#if BRIDGE_TESTS
 if(Fault==point)throw new InvalidOperationException("owned_test_fault");
#endif
 }
#if BRIDGE_TESTS
 static string Fault {get{return Environment.GetEnvironmentVariable("BRIDGE_TEST_FAULT");}}
#endif
 static void Check(int result){if(result!=0)throw new InvalidOperationException("registry_native_"+result);}
 static IntPtr Create(IntPtr parent,string path){IntPtr h;int disposition;Check(RegCreateKeyEx(parent,path,0,null,0,0xf003f,IntPtr.Zero,out h,out disposition));return h;}
 static IntPtr CreateOwned(string path){IntPtr h;int disposition;Check(RegCreateKeyEx(HKCU,path,0,null,0,0xf003f,IntPtr.Zero,out h,out disposition));if(disposition!=1){Check(RegCloseKey(h));throw new InvalidOperationException("key_not_new");}return h;}
 static void Mark(IntPtr h,int value){var b=BitConverter.GetBytes(value);Check(RegSetValueEx(h,"OwnedSentinel",0,4,b,b.Length));}
 static int Read(IntPtr h){int type,size=4;var b=new byte[4];Check(RegQueryValueEx(h,"OwnedSentinel",IntPtr.Zero,out type,b,ref size));return BitConverter.ToInt32(b,0);}
 static void Emit(string kind,string stage){lock(OutputLock)Console.Out.WriteLine(new JavaScriptSerializer().Serialize(new{version=1,kind,stage,time=DateTime.UtcNow.ToString("o")}));}
 static void NoWindows(){bool found=false;EnumWindows((h,p)=>{uint pid;GetWindowThreadProcessId(h,out pid);if(pid==(uint)System.Diagnostics.Process.GetCurrentProcess().Id&&IsWindowVisible(h))found=true;return true;},IntPtr.Zero);if(found)throw new InvalidOperationException("visible_owned_window");}
 [STAThread] static int Main(string[] args){
#if BRIDGE_TESTS
 if(args.Length==1&&args[0]=="--test-timing")return AuthTiming.Tests();
#endif
 if(args.Length==1&&args[0]=="--auth")return AuthHost.Run();
 Console.SetOut(new StreamWriter(Console.OpenStandardOutput()){AutoFlush=true}); Console.SetIn(new StreamReader(Console.OpenStandardInput()));
 string root="Software\\ZhumengPclBridge\\probe-"+Guid.NewGuid().ToString("N");
 string marker="Software\\ZhumengPclBridge\\sentinel-"+Guid.NewGuid().ToString("N");
 IntPtr mapped=IntPtr.Zero,original=IntPtr.Zero;bool overridden=false, originalCreated=false, mappedCreated=false, sentinelEstablished=false;Timer timer=null;int exit=30;
  // The private, copied file is the only target ever hashed or loaded by this process.
  string target=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Plain Craft Launcher 2.exe");
  string hash;try{using(var sha=SHA256.Create())using(var f=File.OpenRead(target))hash=BitConverter.ToString(sha.ComputeHash(f)).Replace("-","");}catch{Emit("rejected","binary_unreadable");Emit("audit","registry_calls_"+RegistryCalls);return 20;}
  if(hash!=Pin){Emit("rejected","hash_mismatch");Emit("audit","registry_calls_"+RegistryCalls);return 20;}
 try {
  if(Path.GetFullPath(Environment.CurrentDirectory).TrimEnd('\\')!=AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'))throw new InvalidOperationException("cwd_mismatch");
  original=CreateOwned(marker);originalCreated=true;Inject("before_sentinel");Mark(original,42);sentinelEstablished=true;
  mapped=CreateOwned(root);mappedCreated=true;Check(RegOverridePredefKey(HKCU,mapped));overridden=true;
  IntPtr isolated=Create(HKCU,marker);try{Mark(isolated,84);if(Read(original)!=42||Read(isolated)!=84)throw new InvalidOperationException("sentinel_isolation");}finally{RegCloseKey(isolated);}
  Emit("status","registry_isolated");
  var request=new JavaScriptSerializer().DeserializeObject(Console.In.ReadLine()??"") as System.Collections.Generic.Dictionary<string,object>;
  if(request==null||request.Count!=1||!request.ContainsKey("command")||(string)request["command"]!="probe")throw new InvalidOperationException("invalid_command");
  timer=new Timer(_=>Emit("heartbeat","probe"),null,0,5000);
  Probe(target);
  Emit("status","initialized");
  // Parent cancellation is bounded to this child; no external processes are inspected or killed.
  var input=Console.In.ReadLine();if(input!="cancel")throw new InvalidOperationException("invalid_cancel");
  NoWindows();Emit("status","cancelled");exit=0;
 }catch(Exception e){ // Never serialize exception messages or target data.
  if(e.InnerException is FileNotFoundException)Emit("diagnostic","missing_assembly:"+new AssemblyName(((FileNotFoundException)e.InnerException).FileName).Name);
  for(var detail=e;detail!=null;detail=detail.InnerException)Emit("diagnostic",detail.GetType().FullName+":"+(detail.TargetSite==null?"none":detail.TargetSite.DeclaringType.FullName+"."+detail.TargetSite.Name));
  Emit("blocked",e is TypeInitializationException?"type_initialization":e is FileNotFoundException?"dependency_missing":"probe_failure");exit=30;
 }finally{
  bool cleanup=true;
  Action<Action> attempt=action=>{try{action();}catch{cleanup=false;}};
  attempt(()=>{if(timer!=null)timer.Dispose();});
  if(overridden)attempt(()=>{Check(RegOverridePredefKey(HKCU,IntPtr.Zero));overridden=false;});
  if(sentinelEstablished && !overridden)attempt(()=>{IntPtr restored=Create(HKCU,marker);try{if(Read(restored)!=42||Read(original)!=42)throw new InvalidOperationException();}finally{Check(RegCloseKey(restored));}});
  if(original!=IntPtr.Zero)attempt(()=>Check(RegCloseKey(original)));
  if(mapped!=IntPtr.Zero)attempt(()=>Check(RegCloseKey(mapped)));
  // Never delete through HKCU while restoration is incomplete, nor paths not created.
  if(overridden)cleanup=false;
  else {
   if(mappedCreated)attempt(()=>Check(RegDeleteTree(HKCU,root)));
   if(originalCreated)attempt(()=>{Inject("delete_failure");Check(RegDeleteTree(HKCU,marker));});
   // Test-injected failure still gets a separate real cleanup attempt; failure remains fatal.
#if BRIDGE_TESTS
   if(originalCreated && Fault=="delete_failure")attempt(()=>Check(RegDeleteTree(HKCU,marker)));
#endif
  }
  Emit("status",cleanup?"registry_cleanup_complete":"registry_cleanup_failed");
  Emit("audit","registry_calls_"+RegistryCalls);
  if(!cleanup)exit=31;
 }
 return exit;
 }
 [MethodImpl(MethodImplOptions.NoInlining)] static void Probe(string target){
  var a=Assembly.LoadFrom(target);
  var resources=new System.Resources.ResourceManager("PCL.Resources",a);
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,args)=>{string name=new AssemblyName(args.Name).Name;if(name!="MeloongCore"&&name!="MeloongCore.Wpf"&&name!="Newtonsoft.Json"&&name!="PCLCS")return null;var bytes=resources.GetObject(name) as byte[];if(bytes==null)return null;var loaded=Assembly.Load(bytes);if(loaded.GetName().Name!=name)throw new InvalidOperationException("dependency_identity");return loaded;};
  foreach(string name in new[]{"PCL.ModBase","PCL.ModMain","PCL.ModLaunch"}){var t=a.GetType(name,true);RuntimeHelpers.RunClassConstructor(t.TypeHandle);NoWindows();Emit("status",name+"_initialized");}
  var modBase=a.GetType("PCL.ModBase",true);foreach(string pathField in new[]{"PathExe","PathTemp"}){string path=(string)modBase.GetField(pathField).GetValue(null);if(!Path.GetFullPath(path).StartsWith(AppDomain.CurrentDomain.BaseDirectory,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("path_escape");}Emit("status","private_pcl_paths");
  var main=a.GetType("PCL.ModMain",true);if(main.GetField("WaitingMyMsgBox").GetValue(null)==null)throw new InvalidOperationException("queue_missing");
  var launch=a.GetType("PCL.ModLaunch",true);if(launch.GetField("McLoginMsLoader").GetValue(null)==null)throw new InvalidOperationException("loader_missing");
  foreach(string name in new[]{"MsLoginStep1New","MsLoginStep1Refresh","MsLoginStep2","MsLoginStep3","MsLoginStep4","MsLoginStep5","MsLoginStep6"}){var m=launch.GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static);if(m==null||m.GetParameters().Length!=1)throw new InvalidOperationException("helper_missing");Emit("contract",name+":"+m.GetParameters()[0].ParameterType+"->"+m.ReturnType);}
  Emit("status","queue_and_helpers_available");NoWindows();
 }
}






using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

internal sealed class AuthIsolation:IDisposable {
 const string Pin="0DB34E19D9EEB6D496D20FABE786EC16BBD36BA6B0CCDC8D29CB7E909C114397";
 static readonly IntPtr HKCU=new IntPtr(unchecked((int)0x80000001));
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)]static extern int RegCreateKeyEx(IntPtr h,string path,int reserved,string cls,int options,int access,IntPtr security,out IntPtr result,out int disposition);
 [DllImport("advapi32.dll")]static extern int RegOverridePredefKey(IntPtr h,IntPtr mapped);
 [DllImport("advapi32.dll")]static extern int RegCloseKey(IntPtr h);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)]static extern int RegDeleteTree(IntPtr h,string path);
 IntPtr mapped;bool active,created;readonly string key;
 internal readonly string Target;
 internal AuthIsolation(string session){
  Target=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Plain Craft Launcher 2.exe");
  using(var sha=SHA256.Create())using(var f=File.OpenRead(Target))if(BitConverter.ToString(sha.ComputeHash(f)).Replace("-","")!=Pin)throw new BridgeFailure("unsupported");
  if(Path.GetFullPath(Environment.CurrentDirectory).TrimEnd('\\')!=AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'))throw new BridgeFailure("unsupported");
  key="Software\\ZhumengPclBridge\\auth-"+Guid.Parse(session).ToString("N");
  int disposition;Check(RegCreateKeyEx(HKCU,key,0,null,0,0xf003f,IntPtr.Zero,out mapped,out disposition));
  if(disposition!=1){RegCloseKey(mapped);mapped=IntPtr.Zero;throw new BridgeFailure("unsupported");}
  created=true;
  try{Check(RegOverridePredefKey(HKCU,mapped));active=true;}catch{Dispose();throw;}
 }
 static void Check(int code){if(code!=0)throw new BridgeFailure("unsupported");}
 // Caller may dispose ONLY after every target auth thread has stopped.
 public void Dispose(){
  if(active){Check(RegOverridePredefKey(HKCU,IntPtr.Zero));active=false;}
  if(mapped!=IntPtr.Zero){Check(RegCloseKey(mapped));mapped=IntPtr.Zero;}
  if(created){Check(RegDeleteTree(HKCU,key));created=false;}
 }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

internal sealed class BridgeFailure:Exception { internal readonly string Code; internal BridgeFailure(string code){Code=code;} }
internal sealed class AuthRequest {
 internal string Command,Session,Refresh;
 internal static AuthRequest Read(TextReader reader){
  var b=new StringBuilder();int n;
  while((n=reader.Read())!=-1&&n!='\n'){if(b.Length>=65536)throw new BridgeFailure("unsupported");b.Append((char)n);}
  if(n==-1&&b.Length==0)return null;
  if(Encoding.UTF8.GetByteCount(b.ToString())>65536)throw new BridgeFailure("unsupported");
  Dictionary<string,object> d;
  try{d=new RequestJson(b.ToString()).Read();}catch{throw new BridgeFailure("unsupported");}
  if(d==null)throw new BridgeFailure("unsupported");
  object c,s;Guid id;
  if(!d.TryGetValue("command",out c)||!(c is string)||!d.TryGetValue("sessionId",out s)||!(s is string)||!Guid.TryParseExact((string)s,"D",out id)||id==Guid.Empty)throw new BridgeFailure("unsupported");
  var r=new AuthRequest{Command=(string)c,Session=id.ToString("D")};
  if(r.Command!="login"&&r.Command!="refresh"&&r.Command!="cancel")throw new BridgeFailure("unsupported");
  if(d.Count!=(r.Command=="refresh"?3:2))throw new BridgeFailure("unsupported");
  if(r.Command=="refresh"){object token;if(!d.TryGetValue("refreshToken",out token)||!(token is string)||((string)token).Length==0||((string)token).Length>16384)throw new BridgeFailure("unsupported");r.Refresh=(string)token;}
  return r;
 }
}
// Requests have one object of string fields only: nesting, duplicate keys and coercion are rejected.
internal sealed class RequestJson {
 readonly string text;int position;
 internal RequestJson(string value){text=value;}
 void White(){while(position<text.Length&&Char.IsWhiteSpace(text[position]))position++;}
 void Take(char c){White();if(position>=text.Length||text[position++]!=c)throw new FormatException();}
 string String(){
  White();Take('"');var b=new StringBuilder();
  while(position<text.Length){char c=text[position++];if(c=='"')return b.ToString();if(c<32)throw new FormatException();
   if(c=='\\'){if(position==text.Length)throw new FormatException();c=text[position++];switch(c){case '"':case '\\':case '/':break;case 'b':c='\b';break;case 'f':c='\f';break;case 'n':c='\n';break;case 'r':c='\r';break;case 't':c='\t';break;case 'u':if(position+4>text.Length)throw new FormatException();c=(char)Convert.ToInt32(text.Substring(position,4),16);position+=4;break;default:throw new FormatException();}}
   b.Append(c);
  }throw new FormatException();
 }
 internal Dictionary<string,object> Read(){
  var d=new Dictionary<string,object>(StringComparer.Ordinal);Take('{');White();
  if(position<text.Length&&text[position]=='}'){position++;}else while(true){var key=String();Take(':');var value=String();d.Add(key,value);White();if(position>=text.Length)throw new FormatException();char c=text[position++];if(c=='}')break;if(c!=',')throw new FormatException();}
  White();if(position!=text.Length)throw new FormatException();return d;
 }
}
internal sealed class AuthEvents {
 readonly object sync=new object();internal readonly string Session;internal volatile string Stage="initializing";bool terminal;
 internal AuthEvents(string id){Session=id;}
 internal void Emit(string kind,Dictionary<string,object> extra=null){lock(sync){if(terminal&&kind!="cleanup")return;var d=new Dictionary<string,object>{{"version",2},{"sessionId",Session},{"kind",kind},{"stage",Stage},{"time",DateTime.UtcNow.ToString("o")}};if(extra!=null)foreach(var p in extra)d.Add(p.Key,p.Value);string json;try{json=new JavaScriptSerializer{MaxJsonLength=65536,RecursionLimit=16}.Serialize(d);}catch{throw new BridgeFailure("unsupported");}if(Encoding.UTF8.GetByteCount(json)>65536)throw new BridgeFailure("unsupported");Console.Out.WriteLine(json);Console.Out.Flush();}}
 internal bool End(string code){lock(sync){if(terminal)return false;Emit("terminal",new Dictionary<string,object>{{"code",code}});terminal=true;return true;}}
 internal void Complete(Dictionary<string,object> credentials){lock(sync){if(terminal)return;Emit("completed",credentials);terminal=true;}}
 internal void Progress(string stage){Stage=stage;Emit("progress");}
}

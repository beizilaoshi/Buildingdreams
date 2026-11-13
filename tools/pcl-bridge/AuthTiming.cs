using System;
using System.Threading;
internal static class AuthTiming {
 internal static int SlowDown(int interval){if(interval<1||interval>295)throw new BridgeFailure("network_error");return interval+5;}
 internal static DateTime Expiry(DateTime issuedAt,int ttl){if(ttl<=0)throw new BridgeFailure("unsupported");return issuedAt.AddSeconds(ttl);}
#if BRIDGE_TESTS
 internal static int Tests(){
  int interval=60;for(int i=0;i<48;i++){int previous=interval;interval=SlowDown(interval);if(interval!=previous+5)throw new Exception("test_failed");}
  bool rejected=false;try{SlowDown(interval);}catch(BridgeFailure){rejected=true;}if(!rejected)throw new Exception("test_failed");
  var issued=DateTime.UtcNow;var expiry=Expiry(issued,60);Thread.Sleep(150);
  if(expiry!=issued.AddSeconds(60)||expiry>=DateTime.UtcNow.AddSeconds(60))throw new Exception("test_failed");
  Console.SetOut(new System.IO.StreamWriter(Console.OpenStandardOutput()){AutoFlush=true});Console.WriteLine("PASS repeated_slow_down=True safe_bound_rejected=True delayed_later_steps_expiry_preserved=True");return 0;
 }
#endif
}

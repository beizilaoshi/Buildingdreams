# Isolated PCL authentication worker

The launcher uses this .NET Framework 4.8 x64 WinExe for isolated PCL authentication. Run `./build.ps1` in PowerShell with installed VS MSBuild/net48 reference assemblies. Restore uses SHA256-pinned Lib.Harmony 2.4.3 net48 in ignored `vendor/`, never global installation. See `third-party/PROVENANCE.md` and MIT license. Production outputs: `bin/Release/PclBridge.exe` and `bin/Release/0Harmony.dll`. Test faults/diagnostics exist only in `bin/Test/` under BRIDGE_TESTS; never distribute that executable.

The original PCL executable is not included in this repository or release. Users supply the supported executable themselves through the launcher. Native compilation must run before `npm run dist`: the npm build only compiles JavaScript and assets. From the repository root, install Node dependencies with `npm ci`, run `powershell -NoProfile -ExecutionPolicy Bypass -File tools/pcl-bridge/build.ps1`, then run the documented application checks and packaging commands. Build prerequisites include Windows x64, Visual Studio MSBuild (discoverable with vswhere) and .NET Framework 4.8 reference assemblies.

## Parent integration contract

1. Generate a fresh nonempty GUID per attempt and reserve it in the parent attempt map. Compute `HKCU\Software\ZhumengPclBridge\auth-<GUID as 32 lowercase hex without hyphens>` independently. An absence check is not registry ownership. The child atomically creates a new key; only after successful create-new and override it flushes progress fields `registryOwned:true`, `registryOwner:"zhumeng.pcl.auth.v2"` with the matching sessionId. Validate this positive acknowledgement from the exact private child pipe before recording registry ownership. Collision produces no acknowledgement; never delete its existing key. Never accept a cleanup path from worker output.
2. Create a private directory. Copy Release EXE/DLL and user-supplied `Plain Craft Launcher 2.exe` into it. Its SHA256 must be `0DB34E19D9EEB6D496D20FABE786EC16BBD36BA6B0CCDC8D29CB7E909C114397`. Never copy user PCL accounts/configuration/logs, call normal startup, or package the original binary.
3. Spawn the private `PclBridge.exe` with single argument `--auth`, private cwd, `windowsHide: true`, private TEMP/TMP/APPDATA/LOCALAPPDATA/USERPROFILE directories and redirected private stdin/stdout/stderr. Immediately send the first JSON line. Never put credentials in argv/environment or forward raw pipes to logs/renderer. Interactive console invocation is unsupported.
4. Enforce bounded UTF-8 JSON lines, exact known fields/types and matching session. One attempt per child. Heartbeat means responsiveness only; the parent provides the initial grace period and waiting UI.
5. Cancel with matching JSON below and wait for owned child exit; a parent deadline may kill only that spawned child. After exit, delete the exact computed registry key only if the validated positive ownership acknowledgement was received; check deletion, then remove its verified private directory. Without acknowledgement, preserve any existing key and report unproved ownership/cleanup failure; this also applies to a crash between atomic creation and acknowledgement. Cleanup is mandatory after every acknowledged post-load path including success, failure/crash. Never restore/remap live child HKCU from the parent.
6. Save credentials in secure main-process account storage only after `completed`, child exit 0 and successful parent cleanup. Rejection/cancellation never saves an account. Unknown events, nonzero exit or missing result/cleanup fail. Tokens/raw profile never go to renderer. Only parent may open validated official device URL.

Requests (replace GUID with canonical reserved GUID):

```json
{"command":"login","sessionId":"GUID"}
{"command":"refresh","sessionId":"GUID","refreshToken":"MAIN_PROCESS_ONLY"}
{"command":"cancel","sessionId":"GUID"}
```

Only these fields are permitted. Refresh token is nonempty, at most 16384 characters. Lines are at most 64 KiB UTF-8; duplicate keys, coercion and nesting are rejected (depth one, stricter than depth-16 ceiling). Subsequent commands must be matching-session cancel; duplicate cancel is idempotent. EOF cancels. Invalid initial input uses all-zero GUID rejection envelope because no valid session exists.

Every event has version 2, sessionId, kind, stage, UTC ISO time. Additional fields:

| Kind | Fields |
| --- | --- |
| heartbeat, progress | none |
| progress (ownership handshake only, before target work) | registryOwned:true, registryOwner:"zhumeng.pcl.auth.v2"; matching envelope sessionId required |
| device | userCode, allowlisted verificationUri, UTC expiresAt, integer interval; never secret device_code |
| completed | uuid, name, accessToken, refreshToken, UTC expiresAt, parsed profile object; main-only |
| terminal | enum code: account_action_required, unlicensed, profile_required, network_error, declined, expired, cancelled, unsupported |
| cleanup | enum code: complete, failed, parent_required |

Completed and terminal are mutually exclusive final attempt events; only cleanup may follow. Heartbeat runs every five seconds independently of auth/input. Stages: initializing, presentation_gate_passed, actual MsLoginStep1New/MsLoginStep1Refresh/MsLoginStep2..6. Exit 0 may accompany auth rejection; event is authoritative. Exit 20 is initialization/protocol rejection; 31 pre-load cleanup failure; 32 blocked owned work terminated with override retained. ALL post-load exits emit cleanup parent_required and retain override until OS teardown, including exit 0, preventing target background code from accessing real HKCU.

## Authentication and presentation boundary

Real pinned PCL Step1New obtains initial device code. Its ConcurrentQueue.TryDequeue converter is consumed privately; bounded HTTPS polling uses its runtime built-in public registration literal, never copied into source. Polling handles interval, slow_down, expiry, decline and cancellation. Converter Result is actual binary's indexable string pair. Refresh calls real Step1Refresh. Both then call real Steps 2, 3, 4, 5 entitlement, 6 profile. Whole McLoginMsStart/McLaunchStart are never invoked.

Hooks exist only inside private worker after pin and HKCU override. Exact targets: PCL.ModMain.MyMsgBox (11 parameters, integer return) and PCL.ModBase.OpenWebsite(string) throw our typed prompt exception; PCL.ModLaunch.McLaunchLog and 16 explicit signature-locked MeloongCore.Logger.Log/Info/Warn/Error overloads discard UI/logging. Exact logger signatures are in AuthRuntime.cs. No auth step, validator, token/crypto or entitlement predicate is patched. No PatchAll; every hook owner is checked. Actual synthetic MyMsgBox invocation must throw our error with unchanged queue before any network. PCL FormMain/MyMsgLogin/Application_Startup are never invoked. Bare WPF Application exists without dispatcher pumping. Input monitor and supervisor run before target initialization on a separate STA; helper networking uses a distinct background thread, preserving PCL's UI-thread prohibition. Cancellation/EOF during blocked initialization terminates the owned process within the supervisor's 250ms join grace, retaining its override. Every slow_down adds five seconds; exceeding a 300-second safe bound fails closed. Token expiry is conservatively anchored before Step4, so Steps5/6 cannot extend it.

## Verification

Run `./auth-smoke.ps1 -Device`. Synthetic tests use Test worker; actual initial-device-code/cancel uses Release. Output contains sanitized booleans/codes/hook signatures only; no user code, registration ID, tokens, prompts or response bodies. No browser or account approval. Cases cover malformed/duplicate/nested/oversize protocol, unknown pin, actual prompt rejection, held work cancel, session mismatch, duplicate cancel, EOF, independent heartbeats, owned visible-window snapshots, exact parent registry/private-file cleanup and unchanged original hash.

`./smoke.ps1` provides initialization and cleanup-negative probes. Without --auth, legacy protocol/version 1 restores/deletes its synthetic roots. Window checks are snapshots, not continuous OS tracing. These worker probes do not establish full Microsoft approval, refresh success, entitlement/profile completion or game play; application integration requires its own checks.

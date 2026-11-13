# Lib.Harmony 2.4.3

Official package: https://www.nuget.org/packages/Lib.Harmony/2.4.3

Restore URL: https://api.nuget.org/v3-flatcontainer/lib.harmony/2.4.3/lib.harmony.2.4.3.nupkg

Package SHA256: `F07AF11A0D62447E7E1B6E3FCF1E28FC75D9F8D1ABF2D6EE79AABCDC4DB43E88`.

Selected asset: `lib/net48/0Harmony.dll`; no package dependencies for net48. NuGet metadata repository commit: `b79f2f1ac971e5bc224cda3efedbbb4084efbfb6`, https://github.com/pardeike/Harmony . Restore verifies the archive hash before extraction on every build. Downloaded package/DLLs remain ignored local build dependencies and are not committed.

MIT license copied verbatim from this package into `Lib.Harmony.LICENSE`.

Official prefix execution reference: https://harmony.pardeike.net/v2/articles/execution.html . The bridge uses explicit per-method prefixes and checks their owner; it never calls PatchAll. The isolated worker verifies the supported PCL executable hash, redirects only its own registry scope and suppresses presentation/logging calls. Authentication, token validation and entitlement predicates are not patched. See the public worker README for the protocol and isolation contract.

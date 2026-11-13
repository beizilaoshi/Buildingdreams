# Compatibility references

The imported-game data-directory selection in `src/main/services/instances.ts` consults PCL 2.12.7.3's saved per-version preferences for interoperability. Reference supplied by the user: the `PCL-2.12.7.3.zip` source archive, `Modules/Minecraft/ModMinecraft.vb` (`PathIndie`) and `Settings.vb` (per-version `PCL/Setup.ini` storage). `VersionArgumentIndieV2` explicitly selects isolated/shared data; legacy values 1/2 have the same meanings.

This is a small independently implemented TypeScript compatibility rule. No VB implementation, branding, or binary was copied. Existing PCL settings and game files are read only; this launcher stores manual mapping overrides in its own instance registry.

## Cinematic home and player appearance (2026-11-04)

Read directly from the supplied ZIP, without extracting or modifying the original:

- `PCL-2.12.7.3/Plain Craft Launcher 2/Pages/PageLaunch/MySkin.xaml.vb`: `Load` clips the face at `(8,8,8,8)` and hat at `(40,8,8,8)` and handles opaque legacy backgrounds; `Clear`, `Save`, `RefreshCache`, `ReloadCache` and `BtnSkinCape_Click` establish the distinction between displaying, refreshing and managing a skin/cape. Only head display is implemented in this task.
- `PCL-2.12.7.3/Plain Craft Launcher 2/Pages/PageLaunch/PageLoginMsSkin.xaml.vb`: `Reload`, `GetLoginData`, `EditSkin` and `BtnExit_Click` associate the displayed player with the authenticated profile and inspect `skins[].state == ACTIVE` after a skin change. The new launcher persists only a validated active public texture URL alongside its encrypted credentials, without exposing profile/token data to the renderer. Skin upload/cape management is still inventory work.
- `PCL-2.12.7.3/Plain Craft Launcher 2/Pages/PageLaunch/PageLaunchRight.xaml.vb`: `RefreshReal`, `LoadContent` and `ForceRefresh` were inspected to separate the PCL custom-home subsystem from the requested scenic launcher shell. This task restores the user's screenshot layout, not arbitrary PCL XAML execution.

The scenic home follows the user-provided UI reference. The TypeScript service and canvas component are independently written; no VB source, upstream default-skin images, upstream binary or branding was copied. The locally drawn fallback is explicitly labeled as a default avatar and does not claim to change an offline game skin. Standard non-interlaced 64×64 and 64×32 PNG textures are supported; other formats/dimensions fail closed to a labeled default.

PNG decoding/re-encoding uses the npm `pngjs` package (MIT), with byte, dimension, chunk, redirect, destination and time bounds applied before decoding. Its resolved version and license are included in the generated runtime inventory and license text. Renderer receives normalized PNG data only; existing HTTPS content-project icons retain their prior CSP allowance.

# Artwork sources

The original artwork files in `public/assets` (listed below) were copied without alteration from a user-authorized existing artwork collection on 2026-11-03. The source directory was read only. Runtime and packaged builds use locally bundled assets.

Wallpaper: moonlake.png (default), aurora.png, garden.png, dunes.png, bloom-light.png, bloom-dark.png.
Opening: opening-lunar.png, opening-liquid.png. Existing marks: logos/lunar.svg, logos/academy.svg, logos/liquid.svg.

The imported files are already included in this repository; normal builds require no original artwork directory or import script. This initial import added no generated artwork or music. Later player avatars use official Minecraft skin services.

On 2026-11-04 four PCL-distributed Minecraft block icons were selectively copied to `src/renderer/assets/pcl-blocks`: Grass.png, CommandBlock.png, CobbleStone.png, GoldBlock.png. Exact archive paths and rights attribution: `notices/pcl-version-assets.txt` and `docs/pcl-source-references.md`. No other archive assets were extracted.

On 2026-11-05 `public/assets/logos/zhumeng-generated.png` was created with the built-in ImageGen tool at the user's explicit request. The generated opaque navy/lavender M-shaped dream-gate PNG is copied without image edits and used consistently for navigation, opening, native window and application icons. It is not copied from PCL or the artwork directory. `build/icon.ico` contains standard 16–256 px resizes generated reproducibly with `electron scripts/make-icon.cjs`. The generated design is an opaque navy/lavender M-shaped dream gate; its original PNG is preserved in the repository.

The earlier marks and opening backgrounds remain preserved assets, but are no longer the primary brand/opening. The optional artwork copy script does not overwrite the new PNG. No WPF opening code or PCL brand mark was reused.

On 2026-11-12 `public/assets/wallpapers/voxel-twilight.png` and `voxel-dawn.png` were generated separately with the built-in ImageGen tool during an initial launcher-background design pass. Both are original generated voxel landscapes, not game screenshots or PCL artwork. Actual output size is 1672×941; original PNG bytes are preserved. The generated scenes depict a twilight voxel landscape and a dawn voxel landscape. No external stock image or separate stock license was supplied. Existing imported wallpapers remain available.

The user then clarified that new backgrounds should match the original moon-lake painterly anime landscape rather than voxel art. `public/assets/wallpapers/sakura-night.png` and `cloud-dawn.png` were generated separately with the built-in ImageGen tool using the authorized `moonlake.png` as a style reference. They retain original 1672×941 output bytes and contain no interface or logo. The style reference is the previously imported moon-lake artwork described above. No additional license grant is asserted for that reference. The original moon-lake remains the default; voxel assets remain optional alternatives.

These source records describe the project’s selective reuse authorization and asset provenance; they do not grant a general redistribution license for third-party artwork or PCL material. Rights remain with their respective owners.

Public Modrinth API fixtures captured 2026-11-04 for deterministic renderer/service tests.

Project metadata: `https://api.modrinth.com/v2/project/{sodium,fabric-api,fabulously-optimized}`.
Team fixtures retain only public usernames/roles from each returned `/v2/team/{team}/members` endpoint.
Icon bytes were fetched from each project's actual `icon_url`. Sodium and Fabulously Optimized are WebP bytes stored with the historical fixture `.png` suffix; tests serve the correct media type. Fabric API is PNG.

These are upstream project names/art used only as test fixtures, not launcher branding. Project license/links remain in their original JSON. No credentials/API keys or upstream PCL private services are included. Browser tests adapt only fixture IDs and version payloads to exercise deterministic dependency/install paths; project identity, descriptions, authors, icons and metrics come from these captures.


Task4A resource captures (2026-11-04): `minecraft-dark-mode`, `complementary-reimagined`, `terralith` project JSON, first public version JSON, public team metadata and the exact returned CDN `icon_url` WebP bytes. Endpoints are `/v2/project/{slug}`, `/v2/project/{id}/version`, `/v2/team/{team}/members`. Test-only project identity/icon/author data retains public provenance and original license fields. Resource UI tests adapt IDs, Minecraft compatibility and file URLs/hashes into a deterministic fixture; screenshots are fixture-backed public identity screens, not live API/install claims. Terralith's direct `project_type` is `mod`, while its loader-tagged ZIP versions represent logical datapacks. Existing shader/resourcepack project types are retained verbatim.

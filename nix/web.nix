{ stdenv, lib, nodejs_22, pnpm, pnpmConfigHook, fetchPnpmDeps }:

stdenv.mkDerivation (finalAttrs: {
  pname = "magic-mirror-web";
  version = "0.1.0";

  # Only include what the build actually needs. Skips dist/, node_modules/,
  # editor cruft, and dotfiles — keeps the source hash stable.
  src = lib.fileset.toSource {
    root = ../web;
    fileset = lib.fileset.unions [
      ../web/package.json
      ../web/pnpm-lock.yaml
      ../web/svelte.config.js
      ../web/tsconfig.json
      ../web/vite.config.ts
      ../web/index.html
      ../web/public
      ../web/src
    ];
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 3;
    # If you bump deps, set this to lib.fakeHash, run `nix-build`, and
    # replace it with the hash Nix prints in the error.
    hash = "sha256-htD4zsqSthfe+W2g6tDqO5GpoLdWNRagWEEaA9N6NFY=";
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild
    pnpm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';

  meta = {
    description = "Static site for the Magic Video Call Mirror";
    homepage = "https://github.com/TuotHash/magic-calling-mirror";
    license = lib.licenses.asl20;
    platforms = lib.platforms.all;
  };
})

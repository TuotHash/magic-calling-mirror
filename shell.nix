# Development shell: `nix-shell` to enter, then `pnpm install && pnpm dev`.

{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    # Same pnpm as nix/web.nix, so a lockfile written here matches the
    # deps hash the package build expects.
    (pkgs.pnpm.override { nodejs = pkgs.nodejs_22; })
  ];
}

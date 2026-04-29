# Development shell: `nix-shell` to enter, then `pnpm install && pnpm dev`.

{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    pkgs.pnpm_9
  ];
}

# Classic-Nix entry point.
#
#   nix-build         → builds the static web client into ./result
#   nix-shell         → drops you into a dev shell with node + pnpm
#
# For NixOS deployment, see ./nix/module.nix.

{ pkgs ? import <nixpkgs> { } }:

pkgs.callPackage ./nix/web.nix { }

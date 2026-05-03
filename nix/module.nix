{ config, lib, pkgs, ... }:

let
  cfg = config.services.magic-mirror;
in
{
  options.services.magic-mirror = {
    enable = lib.mkEnableOption "the Magic Video Call Mirror static web client";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.callPackage ./web.nix { };
      defaultText = lib.literalExpression "pkgs.callPackage ./web.nix { }";
      description = "Built static-site derivation to serve.";
    };

    hostName = lib.mkOption {
      type = lib.types.str;
      example = "mirror.example.com";
      description = ''
        Public hostname. The browser refuses to grant camera access on plain
        HTTP, so this almost certainly needs to be reachable over HTTPS.
      '';
    };

    address = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = ''
        Address nginx should listen on for this virtualHost. Defaults to
        loopback so TLS can be terminated by an upstream proxy.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8017;
      description = ''
        Port nginx should listen on for this virtualHost.
      '';
    };

    nginx = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether to enable services.nginx and add a virtualHost. Set to false
        if you'd rather wire the package into another web server yourself —
        the static files live at `''${config.services.magic-mirror.package}`.
      '';
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    (lib.mkIf cfg.nginx {
      services.nginx = {
        enable = true;
        recommendedGzipSettings = lib.mkDefault true;
        recommendedOptimisation = lib.mkDefault true;
        virtualHosts.${cfg.hostName} = {
          listen = [{
            addr = cfg.address;
            port = cfg.port;
          }];
          root = "${cfg.package}";

          # Vite hashes asset filenames, so they're safe to cache forever.
          # index.html must not be cached or new builds won't be picked up.
          locations."/" = {
            tryFiles = "$uri $uri/ /index.html";
            extraConfig = ''
              add_header Cache-Control "no-cache, must-revalidate";
            '';
          };
          locations."/assets/" = {
            extraConfig = ''
              add_header Cache-Control "public, max-age=31536000, immutable";
            '';
          };
        };
      };
    })
  ]);
}

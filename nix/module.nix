{ config, lib, pkgs, ... }:

let
  cfg = config.services.magic-mirror;

  # nginx drops server-level add_header directives in any location that has
  # its own, so these are repeated in every location below. `always` keeps
  # them on error responses too.
  securityHeaders = ''
    add_header Content-Security-Policy "${cfg.contentSecurityPolicy}" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Content-Type-Options "nosniff" always;
  '';
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

    contentSecurityPolicy = lib.mkOption {
      type = lib.types.str;
      default = lib.concatStringsSep "; " [
        "default-src 'self'"
        # wasm-unsafe-eval: matrix-sdk-crypto and MediaPipe compile WebAssembly.
        # jsdelivr serves MediaPipe's wasm loader script.
        "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net"
        "style-src 'self'"
        # Avatars are fetched with auth and shown as blob: URLs.
        "img-src 'self' blob: data:"
        "media-src 'self' blob:"
        # The homeserver is chosen at runtime, so any https/wss origin is
        # allowed. ws://127.0.0.1 is the optional Pi Agent on the kiosk.
        "connect-src 'self' https: wss: ws://127.0.0.1:* ws://localhost:*"
        "worker-src 'self' blob:"
        "object-src 'none'"
        "base-uri 'none'"
        "form-action 'none'"
        "frame-ancestors 'none'"
      ];
      description = ''
        Content-Security-Policy header sent with every response. The default
        allows any HTTPS homeserver; replace `https: wss:` in `connect-src`
        with your homeserver's origin to tighten it further.
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
            '' + securityHeaders;
          };
          locations."/assets/" = {
            extraConfig = ''
              add_header Cache-Control "public, max-age=31536000, immutable";
            '' + securityHeaders;
          };
        };
      };
    })
  ]);
}

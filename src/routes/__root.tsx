import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import appCss from "../styles.css?url";

const APP_NAME = "Bunny-A";
// shortcut: the theme id is checked against the default only, without full validation; useDocumentTheme always clears it.
const THEME_RESTORE_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("bunny-a.ui-theme.v1")||"null");if(p&&typeof p.theme==="string"&&p.theme!=="glass"){var d=document.documentElement;d.setAttribute("data-theme-restoring","");setTimeout(function(){d.removeAttribute("data-theme-restoring")},1500)}}catch(e){}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Bunny-A routes, runs and monitors your workstation's coding agents with approval before launch.",
      },
      { name: "color-scheme", content: "light dark" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Rendered directly: the head manager de-duplicates <meta> by name and would drop one of the pair. */}
        <meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        {/* M-A-3 T14: a cached non-default theme keeps the shell hidden until the client restores it, instead of flashing the default. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_RESTORE_SCRIPT }} />
      </head>
      <body>
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});

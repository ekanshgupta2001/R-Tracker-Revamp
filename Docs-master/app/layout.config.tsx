import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';
import Discord from "@/app/Discord";

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img className="size-10" src={`${process.env.BASE_PATH}/logo-duck.svg`}
          alt="Pedro Pathing Logo" />
        <span>Pedro Pathing</span>
      </>
    ),
  },
  // see https://fumadocs.dev/docs/ui/navigation/links
  links: [
    {
      text: "Discord",
      url: "https://discord.gg/2GfC4qBP5s",
      icon: <Discord />,
      type: 'icon'
    }
  ],
  githubUrl: "https://github.com/Pedro-Pathing/Docs"
};

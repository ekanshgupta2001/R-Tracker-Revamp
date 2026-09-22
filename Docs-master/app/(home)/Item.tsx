import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function Item({ title, icon, iconClassName, description, href, link = false }: {
  title: string,
  icon: ReactNode,
  iconClassName: string,
  description: string,
  href: string,
  link?: boolean,
}) {
  const Component = link ? Link : "a";

  return (
    <Component href={href}
      className="group my-8 xl:my-0 block xl:basis-0 xl:grow min-w-0 p-6 opacity-75 bg-neutral-300/50 dark:bg-neutral-950/50 border-mauve-400/25 border shadow-sm rounded-4xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:bg-neutral-400/60 dark:hover:bg-neutral-950/80 hover:opacity-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`rounded-xl size-12 p-2 border-2 ${iconClassName}`}>
            {icon}
          </div>
          <span className="text-black dark:text-white/75 text-xl">{title}</span>
        </div>
        <ArrowUpRight
          className="text-black dark:text-white size-10 border-sky-500 border-2 rounded-full p-1 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />
      </div>
      <p className="text-black/60 dark:text-white/50 mt-4 xl:overflow-hidden xl:text-nowrap">{description}</p>
    </Component>
  )
}

import { Monitor } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type WallpaperAppLinkProps = {
  href: string
}

export function WallpaperAppLink({ href }: WallpaperAppLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            className="wallpaper-link"
            variant="ghost"
            size="sm"
            render={<a href={href} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
            aria-label="Open the Nagomi wallpaper app"
          />
        }
      >
        <Monitor aria-hidden="true" />
        <span>Wallpaper app</span>
      </TooltipTrigger>

      <TooltipContent>Use Nagomi as your desktop wallpaper</TooltipContent>
    </Tooltip>
  )
}

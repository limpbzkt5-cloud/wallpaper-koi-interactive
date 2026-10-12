import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type GitHubStarsProps = {
  /** GitHub repository in `owner/repo` format. */
  repo: string
  /** Optional initial star count while the latest count is loaded. */
  stargazersCount?: number
  locales?: Intl.LocalesArgument
}

type GitHubRepositoryResponse = {
  stargazers_count?: number
}

export function GitHubStars({
  repo,
  stargazersCount,
  locales = "en-US",
}: GitHubStarsProps) {
  const [count, setCount] = useState<number | undefined>(stargazersCount)

  useEffect(() => {
    const controller = new AbortController()

    void fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("GitHub request failed")
        return response.json() as Promise<GitHubRepositoryResponse>
      })
      .then((repository) => {
        if (typeof repository.stargazers_count === "number") {
          setCount(repository.stargazers_count)
        }
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [repo])

  const compactCount =
    count === undefined
      ? null
      : new Intl.NumberFormat(locales, {
          notation: "compact",
          compactDisplay: "short",
        })
          .format(count)
          .toLowerCase()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            className="github-stars"
            variant="ghost"
            size="sm"
            render={
              <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            nativeButton={false}
            aria-label="Open this project on GitHub"
          />
        }
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 0C5.37 0 0 5.372 0 11.997 0 17.3 3.438 21.795 8.205 23.38c.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.725-4.042-1.609-4.042-1.609C4.422 17.77 3.633 17.4 3.633 17.4c-1.087-.744.084-.73.084-.73 1.205.085 1.838 1.237 1.838 1.237 1.07 1.834 2.809 1.304 3.495.997.108-.775.417-1.304.76-1.604-2.665-.3-5.466-1.332-5.466-5.929 0-1.31.465-2.38 1.235-3.219-.135-.303-.54-1.523.105-3.175 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.006 2.04.138 3 .404 2.28-1.551 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.608-2.805 5.623-5.475 5.918.42.36.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.284 0 .315.21.69.825.57C20.565 21.79 24 17.291 24 11.997 24 5.372 18.627 0 12 0"
            fill="currentColor"
          />
        </svg>
        {compactCount !== null && (
          <span className="github-stars__count">{compactCount}</span>
        )}
      </TooltipTrigger>

      <TooltipContent className="tabular-nums">
        {count === undefined
          ? "View this project on GitHub"
          : `${new Intl.NumberFormat(locales).format(count)} ${
              count === 1 ? "star" : "stars"
            }`}
      </TooltipContent>
    </Tooltip>
  )
}

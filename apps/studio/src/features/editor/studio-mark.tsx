import type { SVGProps } from "react"

export function StudioMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M5.25 2.25h6.5a2 2 0 0 1 2 2v6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <rect
        height="9.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.5"
        width="9.5"
        x="2.25"
        y="4.25"
      />
      <path
        d="M5 7.25h4M5 9.5h2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </svg>
  )
}

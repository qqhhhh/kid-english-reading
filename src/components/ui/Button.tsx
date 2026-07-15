import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import type { DesignChrome } from "../../lib/designTheme";
import { useDesignChrome } from "../design/DesignThemeContext";

type ButtonVariant = "primary" | "secondary" | "link" | "listen" | "ghost" | "next";
type ButtonSize = "default" | "compact" | "pill";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  chrome?: DesignChrome;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-btn--primary admin-primary-button",
  secondary: "ui-btn--secondary admin-secondary-button",
  link: "ui-btn--link admin-link-button",
  listen: "ui-btn--listen listen-button",
  ghost: "ui-btn--ghost ghost-button",
  next: "ui-btn--next listen-button play-voice-button next-stage-button"
};

export function Button({
  className,
  size = "default",
  type = "button",
  variant = "secondary",
  chrome: chromeProp,
  ...props
}: ButtonProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <button
      className={cn(
        "ui-btn",
        variantClass[variant],
        size === "compact" && "compact-action",
        size === "pill" && "ui-btn--pill",
        `ui-chrome-${chrome}`,
        className
      )}
      data-chrome={chrome}
      type={type}
      {...props}
    />
  );
}

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  "aria-label": string;
  tone?: "neutral" | "danger";
  chrome?: DesignChrome;
};

export function IconButton({ className, tone = "neutral", type = "button", chrome: chromeProp, ...props }: IconButtonProps) {
  const chrome = useDesignChrome(chromeProp);

  return (
    <button
      className={cn(
        "ui-icon-btn",
        tone === "danger" ? "icon-danger-button" : "admin-secondary-button icon-action",
        `ui-chrome-${chrome}`,
        className
      )}
      data-chrome={chrome}
      type={type}
      {...props}
    />
  );
}

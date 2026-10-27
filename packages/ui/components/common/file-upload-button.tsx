"use client";

import { useRef } from "react";
import { Paperclip, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@quickwork/ui/components/ui/button";
import { cn } from "@quickwork/ui/lib/utils";

interface FileUploadButtonProps {
  /** Called with the selected File — caller handles upload. */
  onSelect: (file: File) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "default";
  multiple?: boolean;
  showLabel?: boolean;
}

function FileUploadButton({
  onSelect,
  disabled,
  className,
  size = "default",
  multiple = false,
  showLabel = false,
}: FileUploadButtonProps) {
  const { t } = useTranslation("ui");
  const inputRef = useRef<HTMLInputElement>(null);
  const attachLabel = t(($) => $.attach_file);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";
    for (const file of files) onSelect(file);
  };

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const buttonSize = size === "sm" ? "icon-xs" : "icon-sm";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={buttonSize}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label={attachLabel}
        title={attachLabel}
        className={cn(
          "text-muted-foreground",
          showLabel && "!w-auto gap-1 px-2",
          className,
        )}
      >
        {showLabel ? <Plus className={iconSize} /> : <Paperclip className={iconSize} />}
        {showLabel ? <span className="text-[9.5px]">{attachLabel}</span> : null}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}

export { FileUploadButton, type FileUploadButtonProps };

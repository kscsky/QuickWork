"use client";

import { ChevronRight } from "lucide-react";
import { AppLink } from "../../navigation";
import { PageHeader } from "../../layout/page-header";

export function SettingsModulePage({
  title,
  breadcrumb,
  children,
}: {
  title: string;
  breadcrumb?: { label: string; href: string };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        {breadcrumb ? (
          <>
            <AppLink
              href={breadcrumb.href}
              className="text-caption text-muted-foreground transition-colors hover:text-foreground"
            >
              {breadcrumb.label}
            </AppLink>
            <ChevronRight className="size-3 text-faint-foreground" />
          </>
        ) : null}
        <h1 className="text-caption font-medium">{title}</h1>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

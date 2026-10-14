"use client";

import { StreamPage } from "@quickwork/views/flow";
import { ErrorBoundary } from "@quickwork/ui/components/common/error-boundary";

export default function Page() {
  return (
    <ErrorBoundary>
      <StreamPage />
    </ErrorBoundary>
  );
}

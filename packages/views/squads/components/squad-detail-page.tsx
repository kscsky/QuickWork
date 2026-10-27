"use client";

import { useNavigation } from "../../navigation";
import { SquadManagePage } from "./squad-manage-page";
import { SquadRoomPage } from "./squad-room-page";

export function SquadDetailPage() {
  const { searchParams } = useNavigation();
  // The room is the product surface; the roster/instructions editor lives one
  // click away on the same URL so the mockup's read-only room stays intact.
  return searchParams.get("manage") === "1" ? (
    <SquadManagePage />
  ) : (
    <SquadRoomPage />
  );
}

"use client"

import * as React from "react"

import type { Role } from "@/lib/auth/roles"
import type { MemberOption } from "@/lib/clientes/options"

type TaskListContextValue = {
  members: MemberOption[]
  currentUserId: string
  role: Role
}

const TaskListContext = React.createContext<TaskListContextValue | null>(null)

/** Equipe, usuário e papel da página /tarefas, sem repetir as props em cada item. */
export function TaskListProvider({
  members,
  currentUserId,
  role,
  children,
}: TaskListContextValue & { children: React.ReactNode }) {
  return <TaskListContext value={{ members, currentUserId, role }}>{children}</TaskListContext>
}

export function useTaskListContext() {
  const context = React.useContext(TaskListContext)

  if (!context) {
    throw new Error("useTaskListContext precisa estar dentro de TaskListProvider.")
  }

  return context
}

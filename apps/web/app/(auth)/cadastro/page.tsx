import type { Metadata } from "next"

import { SignUpForm } from "@/app/(auth)/cadastro/signup-form"

export const metadata: Metadata = {
  title: "Criar conta",
}

type CadastroPageProps = {
  searchParams: Promise<{ next?: string | string[] }>
}

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null
}

export default async function CadastroPage({ searchParams }: CadastroPageProps) {
  const params = await searchParams

  return <SignUpForm next={readParam(params.next)} />
}

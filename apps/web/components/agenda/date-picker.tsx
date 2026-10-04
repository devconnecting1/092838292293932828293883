"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { ptBR } from "react-day-picker/locale"

import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import { dateKeyToLocalDate, formatDateKey, localDateToDateKey } from "@/lib/agenda/datetime"

type DatePickerProps = {
  id?: string
  /** "AAAA-MM-DD" ou "" */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
}

/** Campo de data (Popover + Calendar em pt-BR) que trabalha com "AAAA-MM-DD". */
export function DatePicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "Selecione a data",
  disabled,
  invalid,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = value ? dateKeyToLocalDate(value) : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) onBlur?.()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full justify-start font-normal"
            disabled={disabled}
            aria-invalid={invalid || undefined}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {value ? (
          formatDateKey(value)
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={ptBR}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(date ? localDateToDateKey(date) : "")
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

import { db } from '../db'
import type { Attachment, AttachmentKind, AttachmentScope } from '../db/schema'
import { newId } from '../lib/id'
import { deleteFile, readFile, writeFile } from '../storage/fsRoot'
import { extractPdfText } from './pdf'

/** Files bigger than this are stored but not text-indexed, to keep uploads snappy. */
const MAX_EXTRACT_BYTES = 40 * 1024 * 1024

export interface AddAttachmentInput {
  scope: AttachmentScope
  ownerId: string
  courseId: string
  kind: AttachmentKind
  file: File
}

function safeExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(name)
  return m ? m[1].toLowerCase() : 'bin'
}

export async function addAttachment(input: AddAttachmentInput): Promise<string> {
  const id = newId('att')
  const storageKey = `files/${input.courseId}/${id}.${safeExtension(input.file.name)}`
  await writeFile(storageKey, input.file)

  const row: Attachment = {
    id,
    scope: input.scope,
    ownerId: input.ownerId,
    courseId: input.courseId,
    fileName: input.file.name,
    storageKey,
    mimeType: input.file.type || 'application/octet-stream',
    bytes: input.file.size,
    kind: input.kind,
    createdAt: Date.now(),
  }

  if (input.file.type === 'application/pdf' && input.file.size <= MAX_EXTRACT_BYTES) {
    try {
      const extracted = await extractPdfText(input.file)
      row.text = extracted.text
      row.pageCount = extracted.pageCount
    } catch {
      // A PDF we cannot parse is still worth storing; it just won't be searchable.
    }
  }

  await db.attachments.put(row)
  return id
}

export async function removeAttachment(id: string): Promise<void> {
  const row = await db.attachments.get(id)
  if (!row) return
  await deleteFile(row.storageKey)
  await db.attachments.delete(id)
}

/** Reads an attachment back off disk. Returns null if the file has gone missing. */
export async function readAttachment(row: Attachment): Promise<File | null> {
  return readFile(row.storageKey)
}

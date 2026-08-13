import type { HGappDB } from '../schema.ts'
import { DEFAULT_SETTINGS } from '../schema.ts'
import type { AppSettings } from '../types.ts'
import { snapshot, withAudit } from '../audit.ts'

const SINGLETON_ID = 'singleton' as const

/**
 * Vrne nastavitve, pri prvem klicu pa ustvari edino ("singleton") vrstico.
 *
 * Vrnjena vrednost je vedno `DEFAULT_SETTINGS` z vrhu prepisana s tem, kar je
 * dejansko shranjeno — tako nova polja, dodana v novejši različici aplikacije,
 * dobijo smiseln privzeti znesek tudi za stare, že shranjene nastavitve.
 */
export async function getSettings(db: HGappDB): Promise<AppSettings> {
  const existing = await db.settings.get(SINGLETON_ID)
  if (existing) {
    return { ...DEFAULT_SETTINGS, ...existing }
  }

  return withAudit(db, [db.settings], async (audit) => {
    // Med čakanjem na zgornji `get` bi teoretično lahko kdo drug že ustvaril
    // vrstico — znotraj transakcije preverimo še enkrat, preden pišemo.
    const raceCheck = await db.settings.get(SINGLETON_ID)
    if (raceCheck) return { ...DEFAULT_SETTINGS, ...raceCheck }

    const created: AppSettings = { ...DEFAULT_SETTINGS }
    await db.settings.add(created)
    audit.record({
      sessionId: null,
      entityTable: 'settings',
      entityId: SINGLETON_ID,
      action: 'create',
      before: null,
      after: snapshot(created),
      versionAfter: null, // AppSettings nima polja version
    })
    return created
  })
}

export type UpdateSettingsInput = Partial<Omit<AppSettings, 'id'>>

export async function updateSettings(db: HGappDB, patch: UpdateSettingsInput): Promise<AppSettings> {
  return withAudit(db, [db.settings], async (audit) => {
    const existing = await db.settings.get(SINGLETON_ID)
    const before = existing ? snapshot(existing) : null
    const base = existing ?? DEFAULT_SETTINGS

    const updated: AppSettings = { ...base, ...patch, id: SINGLETON_ID }
    await db.settings.put(updated)
    audit.record({
      sessionId: null,
      entityTable: 'settings',
      entityId: SINGLETON_ID,
      action: existing ? 'update' : 'create',
      before,
      after: snapshot(updated),
      versionAfter: null,
    })
    return updated
  })
}

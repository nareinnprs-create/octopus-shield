/**
 * spar CLI output rendering (status + scoreboard), split from the dispatcher
 * to keep both files focused. Pure: engagement in, printable lines out.
 */

import { isRoundOpen, type SparEngagement } from './spar-engagement'
import {
  sparDefensePostureSummary,
  sparEngagementScore,
  sparRoundScore,
  sparTechniqueScoreboards
} from './spar-scoreboard'
export const percent = (rate: number): string => `${Math.round(rate * 100)}%`

export const renderSparStatus = (engagement: SparEngagement): string[] => {
  const lines = [
    `engagement ${engagement.id} "${engagement.name}"`,
    `  status: ${engagement.status}`,
    `  adversary: ${engagement.adversarySource} (${engagement.intensity})`,
    `  garden vm: ${engagement.gardenVmName}`,
    '  rounds:'
  ]
  for (const round of engagement.rounds) {
    const score = sparRoundScore(round)
    const state = isRoundOpen(round) ? 'open' : `concluded@${round.concludedAtEpochMs}`
    lines.push(
      `    ${round.id}  ${state}  exchanges=${score.exchanges}  adversary=${score.pointsAdversary}  defense=${score.pointsDefense}`
    )
  }
  const total = sparEngagementScore(engagement)
  lines.push(
    `  total: exchanges=${total.exchanges} adversary=${total.pointsAdversary} defense=${total.pointsDefense}`
  )
  return lines
}

export const renderSparScoreboard = (engagement: SparEngagement): string[] => {
  const posture = sparDefensePostureSummary(engagement)
  const lines = [
    `scoreboard ${engagement.id}: exchanges=${posture.exchanges} adversary=${posture.pointsAdversary} defense=${posture.pointsDefense} detectionRate=${percent(posture.detectionRate)} (sensor fired ${posture.detected}/${posture.exchanges})`,
    '  per technique:'
  ]
  for (const board of sparTechniqueScoreboards(engagement)) {
    lines.push(
      `    ${board.techniqueId} attempts=${board.attempts} detected=${board.detected} contained=${board.contained} missed=${board.missed} evaded=${board.evaded} defended=${board.defended} breaches=${board.breaches} contained-breach=${board.containedBreaches} adv=${board.pointsAdversary} def=${board.pointsDefense} rate=${percent(board.detectionRate)}`
    )
  }
  lines.push(
    `  weakest: ${posture.weakestTechniques.map((board) => `${board.techniqueId} (${percent(board.detectionRate)})`).join(', ') || '(no exchanges yet)'}`
  )
  return lines
}

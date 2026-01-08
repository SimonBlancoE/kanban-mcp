import { db } from "./db/database";
import type {
  AgentCapability,
  AgentMatchRequirements,
  AgentMatchResult,
} from "./types";

/**
 * AgentCapabilityStore - Manages agent skills for capability-based task assignment
 *
 * Provides CRUD operations for agent capabilities and a matching algorithm
 * that scores agents based on issue labels, keywords, and current workload.
 */
class AgentCapabilityStore {
  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Register a new agent with capabilities
   */
  registerAgent(
    agentId: string,
    skills: string[],
    specializations: string[] = [],
    maxConcurrentTasks: number = 3
  ): AgentCapability {
    const now = new Date().toISOString();
    const capability: AgentCapability = {
      agentId,
      skills: skills.map((s) => s.toLowerCase().trim()),
      specializations: specializations.map((s) => s.toLowerCase().trim()),
      maxConcurrentTasks,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    db.run(
      `INSERT INTO agent_capabilities (agent_id, data) VALUES (?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET data = excluded.data`,
      [agentId, JSON.stringify(capability)]
    );

    return capability;
  }

  /**
   * Get an agent's capabilities
   */
  getAgent(agentId: string): AgentCapability | null {
    const row = db.queryOne<{ data: string }>(
      "SELECT data FROM agent_capabilities WHERE agent_id = ?",
      [agentId]
    );
    return row ? (JSON.parse(row.data) as AgentCapability) : null;
  }

  /**
   * Update an agent's capabilities
   */
  updateAgent(
    agentId: string,
    updates: Partial<Pick<AgentCapability, "skills" | "specializations" | "maxConcurrentTasks" | "isActive">>
  ): AgentCapability | null {
    const existing = this.getAgent(agentId);
    if (!existing) return null;

    const updated: AgentCapability = {
      ...existing,
      ...updates,
      skills: updates.skills
        ? updates.skills.map((s) => s.toLowerCase().trim())
        : existing.skills,
      specializations: updates.specializations
        ? updates.specializations.map((s) => s.toLowerCase().trim())
        : existing.specializations,
      updatedAt: new Date().toISOString(),
    };

    db.run("UPDATE agent_capabilities SET data = ? WHERE agent_id = ?", [
      JSON.stringify(updated),
      agentId,
    ]);

    return updated;
  }

  /**
   * Deactivate an agent (soft delete)
   */
  deactivateAgent(agentId: string): boolean {
    const result = this.updateAgent(agentId, { isActive: false });
    return result !== null;
  }

  /**
   * List all agents
   */
  listAgents(activeOnly: boolean = true): AgentCapability[] {
    const sql = activeOnly
      ? "SELECT data FROM agent_capabilities WHERE is_active = 1 ORDER BY updated_at DESC"
      : "SELECT data FROM agent_capabilities ORDER BY updated_at DESC";

    const rows = db.query<{ data: string }>(sql);
    return rows.map((row) => JSON.parse(row.data) as AgentCapability);
  }

  /**
   * Delete an agent completely
   */
  deleteAgent(agentId: string): boolean {
    const result = db.run("DELETE FROM agent_capabilities WHERE agent_id = ?", [
      agentId,
    ]);
    return result.changes > 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WORKLOAD TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the number of in-progress tasks for an agent
   */
  getAgentWorkload(agentId: string): number {
    const row = db.queryOne<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks WHERE assignee = ? AND column_status = 'in_progress'",
      [agentId]
    );
    return row?.count ?? 0;
  }

  /**
   * Get all agents with their current workload
   */
  getAgentsWithWorkload(activeOnly: boolean = true): Array<AgentCapability & { currentWorkload: number }> {
    const agents = this.listAgents(activeOnly);
    return agents.map((agent) => ({
      ...agent,
      currentWorkload: this.getAgentWorkload(agent.agentId),
    }));
  }

  /**
   * Get agents that have capacity (workload < maxConcurrentTasks)
   */
  getAvailableAgents(): Array<AgentCapability & { currentWorkload: number; availableSlots: number }> {
    return this.getAgentsWithWorkload(true)
      .map((agent) => ({
        ...agent,
        availableSlots: agent.maxConcurrentTasks - agent.currentWorkload,
      }))
      .filter((agent) => agent.availableSlots > 0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MATCHING ALGORITHM
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find the best matching agents for given requirements
   *
   * Scoring:
   * - Direct label → skill match: 10 points
   * - Label → specialization match: 8 points
   * - Title keyword → skill match: 5 points
   * - Title keyword → specialization match: 3 points
   * - Workload penalty: -100 if overloaded, -5 if nearly full
   */
  findBestMatch(requirements: AgentMatchRequirements): AgentMatchResult[] {
    const agents = this.getAgentsWithWorkload(true);
    const results: AgentMatchResult[] = [];

    for (const agent of agents) {
      const matchedSkills: string[] = [];
      const matchedSpecializations: string[] = [];
      const reasons: string[] = [];
      let score = 0;

      // Normalize inputs
      const labels = (requirements.labels ?? []).map((l) => l.toLowerCase().trim());
      const keywords = (requirements.keywords ?? []).map((k) => k.toLowerCase().trim());
      const titleWords = (requirements.title ?? "")
        .toLowerCase()
        .split(/[\s\-_./]+/)
        .filter((w) => w.length > 2);

      // 1. Direct label → skill match (10 points each)
      for (const label of labels) {
        if (agent.skills.includes(label)) {
          score += 10;
          matchedSkills.push(label);
          reasons.push(`skill:${label}`);
        }
      }

      // 2. Label → specialization match (8 points each)
      for (const label of labels) {
        if (agent.specializations.includes(label)) {
          score += 8;
          matchedSpecializations.push(label);
          reasons.push(`spec:${label}`);
        }
      }

      // 3. Keyword → skill match (5 points each)
      for (const keyword of keywords) {
        if (agent.skills.includes(keyword) && !matchedSkills.includes(keyword)) {
          score += 5;
          matchedSkills.push(keyword);
          reasons.push(`keyword-skill:${keyword}`);
        }
      }

      // 4. Title word → skill match (5 points each, max 3)
      let titleMatches = 0;
      for (const word of titleWords) {
        if (titleMatches >= 3) break;
        if (agent.skills.some((s) => word.includes(s) || s.includes(word))) {
          score += 5;
          titleMatches++;
          reasons.push(`title-skill:${word}`);
        }
      }

      // 5. Title word → specialization match (3 points each, max 2)
      let specMatches = 0;
      for (const word of titleWords) {
        if (specMatches >= 2) break;
        if (agent.specializations.some((s) => word.includes(s) || s.includes(word))) {
          score += 3;
          specMatches++;
          reasons.push(`title-spec:${word}`);
        }
      }

      // 6. Workload penalty
      const availableSlots = agent.maxConcurrentTasks - agent.currentWorkload;
      if (availableSlots <= 0) {
        score -= 100;
        reasons.push("overloaded");
      } else if (availableSlots === 1) {
        score -= 5;
        reasons.push("nearly-full");
      }

      // Only include agents with positive score or if no requirements given
      const hasRequirements = labels.length > 0 || keywords.length > 0 || titleWords.length > 0;
      if (score > 0 || !hasRequirements) {
        results.push({
          agentId: agent.agentId,
          score,
          matchedSkills: [...new Set(matchedSkills)],
          matchedSpecializations: [...new Set(matchedSpecializations)],
          currentWorkload: agent.currentWorkload,
          reason: reasons.length > 0 ? reasons.join(", ") : "available",
        });
      }
    }

    // Sort by score descending, then by workload ascending
    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.currentWorkload - b.currentWorkload;
    });
  }

  /**
   * Get the single best match, or null if no suitable agent
   */
  findBestAgent(requirements: AgentMatchRequirements): AgentMatchResult | null {
    const matches = this.findBestMatch(requirements);
    return matches.length > 0 && matches[0].score > 0 ? matches[0] : null;
  }
}

// Singleton instance
export const agentStore = new AgentCapabilityStore();

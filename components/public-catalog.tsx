"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { TOOL_CATEGORIES, formatCategory } from "@/lib/constants";
import { Drill, Leaf, PackageOpen, TentTree, UtensilsCrossed, Wrench } from "lucide-react";
import { useState } from "react";

type PublicTool = { _id: string; name: string; category: string };

function ToolIcon({ category }: { category: string }) {
  if (category.includes("garden")) return <Leaf />;
  if (category.includes("kitchen")) return <UtensilsCrossed />;
  if (category.includes("camp")) return <TentTree />;
  if (category.includes("power")) return <Drill />;
  return <Wrench />;
}

export function PublicCatalog() {
  const [category, setCategory] = useState("");
  const tools = useQuery(api.tools.listPublicAvailable, category ? { category } : {}) as
    | PublicTool[]
    | undefined;

  return (
    <section className="catalog-section" id="catalog">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Available nearby</p>
          <h2>Useful things, already in the neighborhood.</h2>
        </div>
        <label className="filter-field">
          <span className="sr-only">Filter by category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {TOOL_CATEGORIES.map((item) => <option key={item} value={item}>{formatCategory(item)}</option>)}
          </select>
        </label>
      </div>

      {tools === undefined ? (
        <div className="tool-grid" aria-label="Loading available tools">
          {[0, 1, 2].map((item) => <div className="tool-card skeleton" key={item} />)}
        </div>
      ) : tools.length ? (
        <div className="tool-grid">
          {tools.map((tool) => (
            <article className="tool-card" key={tool._id}>
              <span className="tool-icon"><ToolIcon category={tool.category} /></span>
              <div>
                <h3>{tool.name}</h3>
                <p>{formatCategory(tool.category)}</p>
              </div>
              <span className="availability-dot"><i /> Available</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <PackageOpen />
          <h3>No available tools in this category</h3>
          <p>Try another category or check back soon.</p>
        </div>
      )}
    </section>
  );
}

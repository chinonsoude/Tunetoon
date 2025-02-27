// src/components/ui/card.jsx
import React from "react";

export default function Card({ children, className = "", ...props }) {
  return (
    <div
      className={`rounded-md shadow-md ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
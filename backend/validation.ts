import type { Request, Response, NextFunction } from "express";

type Validator = (req: Request, res: Response, next: NextFunction) => void;

export function requireNumericBodyFields(fields: string[]): Validator {
  return (req, res, next) => {
    for (const field of fields) {
      const raw = req.body?.[field];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: `${field} must be a positive number` });
      }
    }
    next();
  };
}

export function requireStringBodyFields(fields: string[]): Validator {
  return (req, res, next) => {
    for (const field of fields) {
      const raw = String(req.body?.[field] ?? "").trim();
      if (!raw) {
        return res.status(400).json({ message: `${field} is required` });
      }
    }
    next();
  };
}

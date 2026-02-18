declare global {
  namespace Express {
    interface Request {
      uid?: string;
      email?: string;
    }
  }
}

export {};

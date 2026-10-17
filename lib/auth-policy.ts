import type { NextAuthConfig } from "next-auth";
import { isEmailAllowed } from "./allowlist";

export const authCallbacks = {
  async signIn({ profile }) {
    // 許可リストの照合には、Google が確認したメールだけを使う。
    return profile?.email_verified === true && await isEmailAllowed(profile.email);
  },
  async jwt({ token }) {
    // 削除済みの利用者は、期限内の Cookie を持っていてもアクセスできない。
    return await isEmailAllowed(token.email) ? token : null;
  },
} satisfies NonNullable<NextAuthConfig["callbacks"]>;

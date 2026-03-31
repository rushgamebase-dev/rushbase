import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const apiKey = process.env.ABLY_API_KEY;

  if (!apiKey) {
    // In dev/mock mode without Ably key, return a fake token response
    return NextResponse.json({
      token: "mock-token",
      expires: Date.now() + 3600000,
      mock: true,
    });
  }

  try {
    const [keyName] = apiKey.split(":");
    const capability = JSON.stringify({
      "mercados:*": ["subscribe", "publish"],
    });

    // Get clientId from query params (wallet address)
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId") || "anonymous";

    const tokenRequest = await fetch(
      `https://rest.ably.io/keys/${keyName}/requestToken`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
        },
        body: JSON.stringify({
          keyName,
          ttl: 3600000, // 1 hour
          capability,
          clientId,
        }),
      }
    );

    if (!tokenRequest.ok) {
      throw new Error(`Ably token request failed: ${tokenRequest.status}`);
    }

    const tokenData = await tokenRequest.json();
    return NextResponse.json(tokenData);
  } catch (error) {
    console.error("Ably token error:", error);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}

export const notificationUserId = "ebay-user-123";

export const notificationBody = JSON.stringify({
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
  notification: {
    notificationId: "test-notification-1",
    eventDate: "2026-09-20T00:00:00.000Z",
    publishDate: "2026-09-20T00:00:01.000Z",
    publishAttemptCount: 1,
    data: {
      username: "test_seller",
      userId: notificationUserId,
      eiasToken: "nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6wJnY+gCJODogudj6x9nY+seQ==",
    },
  },
});

export const notificationSignatureDer =
  "MEQCIHFAvR0hG9iGGtRaC9awbeOykKlrTEvFj16yu1X4uKu8AiA09VNK/x5vCF/3wwbO2dzxkB1sy6VpJptJTwfBK2GrZw==";

export const notificationPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEHcM4htP5EuO4axPgJgC0RJHodLjS
7ygXDnT65JAmsuDARm8dRzT9bwuucYnSiurjhXJn2+JwWDVAlHnQTL2osA==
-----END PUBLIC KEY-----`;

export const otherPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEwJm6/MpN6PlDLU06VTrRcqrFM9JX
VcRUIJ6WLVy86VP7lIy6y1lKxBlO/xVmQypS+BhddZjNTb/Zt9aDL6xSSA==
-----END PUBLIC KEY-----`;

/** SHA-256 hex of "abc" + "token123" + "https://example.convex.site/ebay/account-deletion". */
export const handshakeHash = "48e17d1b8b2f440a0d0e6b84ccc88ac7879e8d2cde5d84f07ca5be90f2281c2d";

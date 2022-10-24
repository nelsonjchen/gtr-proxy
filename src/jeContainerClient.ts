// Just Enough ContainerClient
// A reimplementation of the Azure Storage ContainerClient that only supports
// the methods we need and some that don't exist upstream.

import "isomorphic-fetch";

const fetch = globalThis.fetch;

export class ContainerClient {
  constructor(public readonly containerUrl: string) {
    this.containerUrl = containerUrl;
  }

  getBlockBlobClient(blobName: string): BlockBlobClient {
    return new BlockBlobClient(this, blobName);
  }
}

export class BlockBlobClient {
  constructor(
    public readonly containerClient: ContainerClient,
    public readonly blobName: string,
  ) {
    this.containerClient = containerClient;
    this.blobName = blobName;
  }

  // This does not exist upstream. This is to be run inside a worker in a
  // datacenter environment.
  async workerStageBlockFromURL(
    blockId: string,
    sourceUrl: string,
    offset: number,
    count: number
  ): Promise<Response> {
    console.log(`Staging block ${blockId} from ${sourceUrl}`);
    const containerUrl = new URL(this.containerClient.containerUrl);
    const blobUrl = new URL(
      containerUrl.protocol +
        "//" +
        containerUrl.host +
        containerUrl.pathname +
        `/${this.blobName}` +
        containerUrl.search +
        `&blockid=${blockId}` +
        `&comp=block`
    );

    // Fetch the source URL ourselves and get the body as a stream.
    const sourceResp = await fetch(sourceUrl, {
      headers: {
        Range: `bytes=${offset}-${offset + count - 1}`,
      },
    });

    const resp = await fetch(blobUrl.toString(), {
      method: "PUT",
      headers: {
        "x-ms-version": "2020-10-02",
      },
      body: sourceResp.body,
    });
    if (resp.ok) {
      return resp;
    }
    const text = await resp.text();
    throw new Error(`Failed to stage block: ${resp.status} ${text}`);
  }

  async commitBlockList(blocks: string[]): Promise<Response> {
    console.log(`Committing block list: ${blocks}`);
    const containerUrl = new URL(this.containerClient.containerUrl);
    const blobUrl = new URL(
      containerUrl.protocol +
        "//" +
        containerUrl.host +
        containerUrl.pathname +
        `/${this.blobName}` +
        containerUrl.search +
        `&comp=blocklist`
    );
    const data = `<?xml version="1.0" encoding="utf-8"?>
<BlockList>
${blocks.map((blockId) => `<Latest>${blockId}</Latest>`).join("\n")}
</BlockList>`;

    const resp = await fetch(blobUrl.toString(), {
      method: "PUT",
      body: data,
      headers: {
        "x-ms-version": "2020-10-02"
      }
    });

    if (resp.ok) {
      return resp;
    }
    throw new Error(`Failed to commit block list: ${resp.status}`);
  }
}

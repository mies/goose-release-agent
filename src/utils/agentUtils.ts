import { type Bindings } from "../types";

/**
 * Sends a request to an agent via HTTP and returns the response.
 * 
 * @param agentNamespace The namespace of the agent to query
 * @param agentName The name of the agent to query
 * @param params Key-value pairs of query parameters
 * @param room Optional room identifier, defaults to 'default'
 * @returns Response from the agent
 */
export async function queryAgent(
  agentNamespace: DurableObjectNamespace,
  agentName: string,
  params: Record<string, string>,
  room: string = 'default'
): Promise<Response> {
  // Create a direct request to the agent using its namespace
  const id = agentNamespace.idFromName(room);
  const stub = agentNamespace.get(id);
  
  // Set the required headers for direct Durable Object interaction
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('x-partykit-namespace', agentName);
  headers.set('x-partykit-room', room);
  
  // Create an internal URL for the agent
  const url = new URL('http://internal/');
  
  // Add query parameters
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  
  // Create the request
  const agentRequest = new Request(url.toString(), {
    method: 'GET',
    headers: headers,
  });
  
  // Send the request to the agent
  return await stub.fetch(agentRequest);
} 
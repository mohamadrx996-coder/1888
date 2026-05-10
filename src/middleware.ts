import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const match = pathname.match(/^\/api\/([a-z][a-z0-9-/]*)$/)
  if (match) {
    const url = request.nextUrl.clone()
    url.pathname = '/api/_handler'
    url.searchParams.set('_action', match[1])
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}

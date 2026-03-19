using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace EpCubeGraph.Api;

/// <summary>
/// Passthrough authentication handler for local development.
/// Approves all requests with a synthetic identity.
/// Only active when Authentication:DisableAuth (or EPCUBE_DISABLE_AUTH) is true AND environment is Development.
/// </summary>
public sealed class NoAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public NoAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, "local-dev-user"),
            new Claim(ClaimTypes.Name, "Local Developer"),
            new Claim("scp", "user_impersonation"),
        };
        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
